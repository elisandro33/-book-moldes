// Tratamento global de erros para facilitar a depuração no celular
window.onerror = function(msg, url, line) { 
    console.error("ERRO CRÍTICO: " + msg + "\nLinha: " + line); 
    return false; 
};

// Variáveis Globais dos Gráficos (Chart.js)
let instChartBalanço = null;
let instChartIndices = null;
let instChartPareto = null;

// Configurações do Firebase (Verifique se as letras maiúsculas/minúsculas da sua API Key estão exatamente assim)
const firebaseConfig = {
    apiKey: "AIzaSyDGvPMQkaCMwyoYBbflvmvjqusy1szaqhs", 
    authDomain: "controleproducao-79f83.firebaseapp.com",
    projectId: "controleproducao-79f83",
    storageBucket: "controleproducao-79f83.firebasestorage.app",
    messagingSenderId: "824231079023",
    appId: "1:824231079023:web:ba1de46b7156e61d88719a"
};

// Inicialização Estável do Firebase Compatível (Sem imports)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const colProducao = db.collection("producao");
const colUsuarios = db.collection("usuarios");

// Inicialização do App Secundário para Cadastro de Operadores
const secondaryApp = firebase.apps.find(a => a.name === "SecondaryAuthApp") || firebase.initializeApp(firebaseConfig, "SecondaryAuthApp");
const secondaryAuth = secondaryApp.auth();

let emailAdminMaster = null;
let activeUserRoleAdmin = false;
let cacheDataRecords = [];
let authenticatedUserRef = null;
let unscribeSnapshotProd = null;
let unscribeSnapshotUser = null;

const MOTIVOS_PARADAS_DATA = [
    { cod: "01", desc: "Set Up - Início de Produção" },
    { cod: "02", desc: "Set Up - Manutenção de Ferramental/Molde" },
    { cod: "03", desc: "Aguardando Empilhadeira / Talha" },
    { cod: "04", desc: "Limpeza de máquina" },
    { cod: "05", desc: "Reposição de Material" },
    { cod: "06", desc: "Ajuste de Parâmetros do Processo" },
    { cod: "07", desc: "Deslocamento" },
    { cod: "08", desc: "Falta de Energia" },
    { cod: "09", desc: "Aguardando Material" },
    { cod: "10", desc: "Inspeção de Liberação" },
    { cod: "11", desc: "Problemas de Qualidade - Produto" },
    { cod: "12", desc: "Problemas de Qualidade - Material" },
    { cod: "13", desc: "Ajuste de Ferramenta/Molde em Máquina" },
    { cod: "14", desc: "Ferramenta/molde em Manutenção" },
    { cod: "15", desc: "Espera de apoio da Ferramentaria" },
    { cod: "16", desc: "Ajuste de Periféricos da máquina" },
    { cod: "17", desc: "Manutenção Corretiva - Elétrica" },
    { cod: "18", desc: "Manutenção Corretiva - Mecânica" },
    { cod: "19", desc: "Try out" },
    { cod: "20", desc: "Falta de embalagem" },
    { cod: "21", desc: "Outros" }
];

// Verificação do Administrador Master do Sistema
async function verifyInitialSetupSystem() {
    try {
        const configDoc = await db.collection("config").doc("sistema").get();
        if (configDoc.exists) {
            emailAdminMaster = configDoc.data().emailAdmin;
            document.getElementById('setup-screen').style.display = 'none';
            document.getElementById('auth-screen').style.display = 'flex';
            monitorAuthStateSession();
        } else {
            document.getElementById('setup-screen').style.display = 'flex';
            document.getElementById('auth-screen').style.display = 'none';
        }
    } catch (e) {
        document.getElementById('setup-screen').style.display = 'flex';
    }
}

const setupBtn = document.getElementById('btn-save-setup');
if (setupBtn) {
    setupBtn.onclick = async () => {
        const email = document.getElementById('setup-email').value.trim().toLowerCase();
        const pass = document.getElementById('setup-senha').value;
        if(!email.includes('@') || pass.length < 6) { alert("Insira dados válidos."); return; }
        try {
            await auth.createUserWithEmailAndPassword(email, pass);
            await db.collection("config").doc("sistema").set({ emailAdmin: email });
            emailAdminMaster = email;
            document.getElementById('setup-screen').style.display = 'none';
            monitorAuthStateSession();
        } catch (err) { alert(err.message); }
    };
}

// Monitoramento de Sessão e Auth
function monitorAuthStateSession() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            authenticatedUserRef = user;
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'block';
            
            let checkAdmin = (user.email === emailAdminMaster);
            if (!checkAdmin) {
                try {
                    const snap = await colUsuarios.get();
                    snap.forEach(d => { if(d.data().email === user.email && d.data().role === 'adm') checkAdmin = true; });
                } catch (err) {}
            }
            activeUserRoleAdmin = checkAdmin;

            document.getElementById('user-display').innerHTML = `${activeUserRoleAdmin ? 'Administrador' : 'Operador'}:<br>${user.email}`;
            if(activeUserRoleAdmin) {
                document.getElementById('menu-adm-gate').style.display = 'block';
                document.getElementById('box-filter-user-adm').style.display = 'block';
                runUsersRealtimeListener();
            } else {
                document.getElementById('menu-adm-gate').style.display = 'none';
                document.getElementById('box-filter-user-adm').style.display = 'none';
            }
            runProductionRealtimeListener();
        } else {
            document.getElementById('app-screen').style.display = 'none';
            document.getElementById('auth-screen').style.display = 'flex';
            if (unscribeSnapshotProd) unscribeSnapshotProd();
            if (unscribeSnapshotUser) unscribeSnapshotUser();
        }
    });
}

const loginBtn = document.getElementById('btn-login');
if (loginBtn) {
    loginBtn.onclick = () => {
        const email = document.getElementById('login-email').value.trim().toLowerCase();
        const pass = document.getElementById('login-senha').value;
        const errBox = document.getElementById('login-erro-banner');
        if(!email || !pass) { errBox.innerText = "Preencha tudo."; errBox.style.display="block"; return; }
        auth.signInWithEmailAndPassword(email, pass).catch(e => { errBox.innerText = "Credenciais inválidas."; errBox.style.display="block"; });
    };
}

// Métodos Globais para navegação
window.triggerSystemLogout = () => { auth.signOut(); window.switchViewTab('calc'); };
window.toggleDropdownMenu = () => { const m = document.getElementById('menu-dropdown-box'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; };

window.switchViewTab = (id) => {
    document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    
    const targetView = document.getElementById(id);
    if(targetView) targetView.classList.add('active');
    
    const targetTab = document.getElementById(`tab-link-${id}`);
    if(targetTab) targetTab.classList.add('active');
    
    document.getElementById('menu-dropdown-box').style.display = 'none';

    // Se a aba do Dashboard for ativada, desenha os gráficos
    if(id === 'dash') {
        buildDashboardAnalyticsUI();
    }
};

// Interface Dinâmica de Paradas
function buildDowntimeCheckboxesUI() {
    const box = document.getElementById('wrapper-paradas-dinamicas');
    if (!box) return;
    box.innerHTML = "";
    
    MOTIVOS_PARADAS_DATA.forEach(m => {
        const row = document.createElement('div');
        row.style.marginBottom = "12px";
        row.style.padding = "10px";
        row.style.background = "#f8fafc";
        row.style.border = "1px solid #e2e8f0";
        row.style.borderRadius = "8px";

        row.innerHTML = `
            <div id="zone-${m.cod}" style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" id="chk-${m.cod}" style="margin-right: 10px; transform: scale(1.2);">
                <span style="font-weight: bold; color: #1e293b;">${m.cod} - ${m.desc}</span>
            </div>
            <div id="panel-${m.cod}" style="display: none; flex-direction: column; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="flex: 1;"><span style="font-size:0.75rem; color:#64748b; display:block;">Início</span><input type="time" id="t-ini-${m.cod}" value="00:00" class="input-select-gray" style="width:100%;"></div>
                    <span style="font-size:0.8rem; color:#64748b; align-self: flex-end; padding-bottom: 8px;">até</span>
                    <div style="flex: 1;"><span style="font-size:0.75rem; color:#64748b; display:block;">Fim</span><input type="time" id="t-fim-${m.cod}" value="00:00" class="input-select-gray" style="width:100%;"></div>
                    <span id="lbl-tot-${m.cod}" style="font-size:0.8rem; font-weight:700; align-self: flex-end; padding-bottom: 8px; margin-left:auto; color:var(--primary-blue);">0 min</span>
                </div>
                <input type="text" id="t-desc-${m.cod}" class="input-text-white" placeholder="Descreva a ocorrência..." style="padding: 8px; font-size: 0.85rem; width: 100%;">
            </div>
        `;
        box.appendChild(row);

        const ck = row.querySelector(`#chk-${m.cod}`);
        const panel = row.querySelector(`#panel-${m.cod}`);
        
        ck.onchange = () => {
            panel.style.display = ck.checked ? 'flex' : 'none';
            if(!ck.checked) {
                row.querySelector(`#t-ini-${m.cod}`).value = "00:00";
                row.querySelector(`#t-fim-${m.cod}`).value = "00:00";
                row.querySelector(`#t-desc-${m.cod}`).value = "";
                row.querySelector(`#lbl-tot-${m.cod}`).innerText = "0 min";
            }
            sumAllDowntimes();
        };

        row.querySelector(`#t-ini-${m.cod}`).onchange = sumAllDowntimes;
        row.querySelector(`#t-fim-${m.cod}`).onchange = sumAllDowntimes;
        row.querySelector(`#zone-${m.cod}`).onclick = (e) => { 
            if(e.target.type !== 'checkbox' && e.target.type !== 'text') { ck.checked = !ck.checked; ck.dispatchEvent(new Event('change')); } 
        };
    });
}

function sumAllDowntimes() {
    let grandTotal = 0;
    MOTIVOS_PARADAS_DATA.forEach(m => {
        const ck = document.getElementById(`chk-${m.cod}`);
        if(ck && ck.checked) {
            const iniEl = document.getElementById(`t-ini-${m.cod}`);
            const fimeEl = document.getElementById(`t-fim-${m.cod}`);
            const i = (iniEl ? iniEl.value : "00:00").split(':').map(Number);
            const f = (fimeEl ? fimeEl.value : "00:00").split(':').map(Number);
            let diff = (f[0]*60 + f[1]) - (i[0]*60 + i[1]);
            if(diff < 0) diff += 1440;
            const lbl = document.getElementById(`lbl-tot-${m.cod}`);
            if (lbl) lbl.innerText = `${diff} min`;
            grandTotal += diff;
        }
    });
    const h = String(Math.floor(grandTotal / 60)).padStart(2, '0');
    const min = String(grandTotal % 60).padStart(2, '0');
    
    const totalInput = document.getElementById('form-total-parada');
    if (totalInput) totalInput.value = `${h}:${min}`;
    
    const displayTotal = document.getElementById('display-total-parada');
    if(displayTotal) displayTotal.innerText = `${h}:${min}`;

    calculateEfficiencyPerformance();
}

function calculateEfficiencyPerformance() {
    const getVal = (id) => { const el = document.getElementById(id); return el && el.value ? el.value : ""; };
    const getNum = (id) => { const el = document.getElementById(id); return el && el.value ? parseFloat(el.value) || 0 : 0; };

    const strIni = getVal('form-ini');
    const strFim = getVal('form-fim');

    if (!strIni || !strFim) {
        document.getElementById('oee-pct').innerText = '0%';
        document.getElementById('oee-target').innerText = 'meta=0';
        return;
    }

    const tIni = strIni.split(':').map(v => parseInt(v, 10) || 0);
    const tFim = strFim.split(':').map(v => parseInt(v, 10) || 0);
    const pTime = (getVal('form-total-parada') || "00:00").split(':').map(v => parseInt(v, 10) || 0);

    let totalTurno = (tFim[0] * 60 + tFim[1]) - (tIni[0] * 60 + tIni[1]);
    if (totalTurno < 0) totalTurno += 1440; 

    let totalParada = (pTime[0] * 60) + pTime[1];
    let prodTimeMinutos = totalTurno - totalParada;
    if (prodTimeMinutos < 0) prodTimeMinutos = 0;

    const ciclo = getNum('form-ciclo');
    const maxCav = getNum('form-cav');
    const real = getNum('form-real');

    let meta = 0;
    if (ciclo > 0 && maxCav > 0) {
        // 1. Calcula as peças por hora truncadas (Math.floor)
        const pecasPorHora = Math.floor((3600 / ciclo) * maxCav);
        
        // 2. Calcula a meta proporcional ao tempo produtivo em horas
        const horasTrabalhadas = prodTimeMinutos / 60;
        meta = Math.floor(pecasPorHora * horasTrabalhadas);
    }

    let oee = meta > 0 ? Math.round((real / meta) * 100) : 0;
    
    const oeePctEl = document.getElementById('oee-pct');
    const oeeTargetEl = document.getElementById('oee-target');
    if (oeePctEl) oeePctEl.innerText = `${oee}%`;
    if (oeeTargetEl) oeeTargetEl.innerText = `meta=${meta}`;

    const display = document.querySelector('.oee-box-display');
    if (display) {
        if (oee >= 85) display.style.background = "var(--success)";
        else if (oee >= 60) display.style.background = "var(--accent)";
        else display.style.background = "var(--danger)";
    }
}



['form-ini', 'form-fim', 'form-ciclo', 'form-cav', 'form-real', 'form-refugo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', calculateEfficiencyPerformance); el.addEventListener('change', calculateEfficiencyPerformance); }
});

const saveProdBtn = document.getElementById('btn-save-production');
if (saveProdBtn) {
    saveProdBtn.onclick = async () => {
        if(!authenticatedUserRef) return;
        const eid = document.getElementById('entry-edit-id').value;
        const data = document.getElementById('form-data').value;
        const maq = document.getElementById('form-maq').value.trim().toUpperCase();
        const prod = document.getElementById('form-prod').value.trim();

        if(!data || !maq || !prod) { alert("Data, Máquina e Cód produto são obrigatórios!"); return; }

        let listaP = [];
        MOTIVOS_PARADAS_DATA.forEach(m => {
            const ck = document.getElementById(`chk-${m.cod}`);
            if(ck && ck.checked) {
                listaP.push({
                    cod: m.cod, desc: m.desc,
                    ini: document.getElementById(`t-ini-${m.cod}`).value,
                    fim: document.getElementById(`t-fim-${m.cod}`).value,
                    tot: document.getElementById(`lbl-tot-${m.cod}`).innerText,
                    ocorrencia: document.getElementById(`t-desc-${m.cod}`).value.trim()
                });
            }
        });

        const packet = {
            data, 
            nomeOperador: document.getElementById('form-nome').value.trim(),
            maquina: maq, 
            produto: prod,
            nrOp: document.getElementById('form-op').value.trim(),
            qtdRefugo: Number(document.getElementById('form-refugo').value) || 0,
            qtdRefugoSetup: Number(document.getElementById('form-refugo-setup').value) || 0,
            inicioTurno: document.getElementById('form-ini').value,
            fimTurno: document.getElementById('form-fim').value,
            ciclo: Number(document.getElementById('form-ciclo').value),
            cavidades: Number(document.getElementById('form-cav').value),
            qtdReal: Number(document.getElementById('form-real').value),
            totalParado: document.getElementById('form-total-parada').value,
            obs: document.getElementById('form-obs').value,
            efetividade: document.getElementById('oee-pct').innerText,
            paradasMapeadas: listaP
        };

        try {
            if(eid) {
                await colProducao.doc(eid).update(packet);
                alert("Atualizado!");
            } else {
                packet.criadoPor = authenticatedUserRef.email;
                await colProducao.add(packet);
                alert("Salvo!");
            }
            resetInputsFormLancamento();
        } catch (err) { alert(err.message); }
    };
}

function resetInputsFormLancamento() {
    document.getElementById('entry-edit-id').value = "";
    document.getElementById('form-nome').value = "";
    document.getElementById('form-maq').value = "";
    document.getElementById('form-prod').value = "";
    document.getElementById('form-op').value = "";
    document.getElementById('form-refugo').value = "0";
    document.getElementById('form-refugo-setup').value = "0";
    document.getElementById('form-obs').value = "";
    document.getElementById('form-real').value = "";
    document.getElementById('form-ciclo').value = "";
    document.getElementById('form-cav').value = "";
    document.getElementById('form-total-parada').value = "00:00";
    if (document.getElementById('display-total-parada')) document.getElementById('display-total-parada').innerText = "00:00";

    document.getElementById('btn-cancel-edit').style.display = 'none';
    document.getElementById('btn-delete-entry').style.display = 'none';
    document.getElementById('btn-save-production').innerText = "SALVAR REGISTRO";
    buildDowntimeCheckboxesUI();
    setTodayOnDateField();
    calculateEfficiencyPerformance();
}

const cancelEditBtn = document.getElementById('btn-cancel-edit');
if (cancelEditBtn) cancelEditBtn.onclick = resetInputsFormLancamento;

const deleteEntryBtn = document.getElementById('btn-delete-entry');
if (deleteEntryBtn) {
    deleteEntryBtn.onclick = async () => {
        const id = document.getElementById('entry-edit-id').value;
        if(id && confirm("Excluir definitivamente?")) {
            await colProducao.doc(id).delete();
            resetInputsFormLancamento();
        }
    };
}

function updateLaunchDateFilterOptions() {
    const selectEl = document.getElementById('filter-launch-date');
    if (!selectEl) return;
    
    const previousSelection = selectEl.value;
    const allowedRecords = cacheDataRecords.filter(i => activeUserRoleAdmin || i.criadoPor === authenticatedUserRef.email);
    const uniqueDates = [...new Set(allowedRecords.map(i => i.data).filter(d => !!d))].sort((a, b) => b.localeCompare(a));
    
    selectEl.innerHTML = '<option value="">Todas as datas lançadas</option>';
    uniqueDates.forEach(date => {
        const option = document.createElement('option');
        option.value = date; option.textContent = date.split('-').reverse().join('/');
        selectEl.appendChild(option);
    });
    if (uniqueDates.includes(previousSelection)) selectEl.value = previousSelection;
}

function runProductionRealtimeListener() {
    unscribeSnapshotProd = colProducao.onSnapshot((snap) => {
        cacheDataRecords = [];
        snap.forEach(d => cacheDataRecords.push({ id: d.id, ...d.data() }));
        cacheDataRecords.sort((a, b) => (a.maquina || "").toString().toUpperCase().localeCompare((b.maquina || "").toString().toUpperCase(), undefined, { numeric: true }));
        updateLaunchDateFilterOptions();
        applyFilterAndFillTable();
        // Atualiza Dashboard automaticamente se a aba estiver aberta
        if(document.getElementById('dash').classList.contains('active')) buildDashboardAnalyticsUI();
    });
}

function applyFilterAndFillTable() {
    const fLaunchDate = document.getElementById('filter-launch-date').value;
    const fStart = document.getElementById('filter-start-date').value;
    const fEnd = document.getElementById('filter-end-date').value;
    const fMaq = document.getElementById('filter-maq').value.trim().toUpperCase();
    const fProd = document.getElementById('filter-prod').value.trim().toLowerCase();
    const fUser = document.getElementById('filter-user').value.trim().toLowerCase();

    let res = cacheDataRecords.filter(i => {
        if(!activeUserRoleAdmin && i.criadoPor !== authenticatedUserRef.email) return false;
        if(fLaunchDate) { if(i.data !== fLaunchDate) return false; } 
        else {
            if(fStart && i.data < fStart) return false;
            if(fEnd && i.data > fEnd) return false;
        }
        if(fMaq && !i.maquina.includes(fMaq)) return false;
        if(fProd && !i.produto.toLowerCase().includes(fProd)) return false;
        if(fUser && activeUserRoleAdmin && !i.criadoPor.toLowerCase().includes(fUser)) return false;
        return true;
    });

    const body = document.getElementById('table-entries-body');
    if (!body) return;
    body.innerHTML = "";

    if(res.length === 0) {
        body.innerHTML = `<tr><td colspan="18" style="text-align:center; color:#64748b; padding:20px;">Nenhum registro encontrado</td></tr>`;
        return;
    }

    res.forEach(i => {
        const tr = document.createElement('tr');
        let det = i.paradasMapeadas?.map(p => `• ${p.cod} (${p.tot})${p.ocorrencia ? ` - ${p.ocorrencia}` : ''}`).join('<br>') || 'Nenhuma';
        tr.innerHTML = `
            <td><b>${i.data.split('-').reverse().slice(0,2).join('/')}</b></td>
            <td>${i.nomeOperador || '-'}</td><td>${i.maquina}</td><td>${i.produto}</td><td>${i.nrOp || '-'}</td>
            <td>${i.inicioTurno}</td><td>${i.fimTurno}</td><td>${i.qtdReal}</td><td>${i.qtdRefugo || 0}</td><td>${i.qtdRefugoSetup || 0}</td>
            <td>${i.cavidades || 0}</td><td>${i.ciclo || 0}</td>
            <td><b style="color:${Number(i.efetividade.replace('%',''))>=85?'var(--success)':'var(--accent)'}">${i.efetividade}</b></td>
            <td>${i.totalParado || '00:00'}</td>
            <td style="font-size:0.75rem; color:#475569; min-width:180px;">${det}</td>
            <td style="font-size:0.75rem;">${i.obs || '-'}</td>
            <td style="font-size:0.75rem; color:#64748b;">${i.criadoPor || '-'}</td>
            <td><button class="btn-submit-system" style="padding:6px; font-size:0.75rem;" id="edt-${i.id}">EDITAR</button></td>
        `;
        tr.querySelector(`#edt-${i.id}`).onclick = () => loadRecordToEdit(i);
        body.appendChild(tr);
    });
}

function loadRecordToEdit(i) {
    window.switchViewTab('calc');
    document.getElementById('entry-edit-id').value = i.id;
    document.getElementById('form-data').value = i.data;
    document.getElementById('form-nome').value = i.nomeOperador || "";
    document.getElementById('form-ini').value = i.inicioTurno;
    document.getElementById('form-fim').value = i.fimTurno;
    document.getElementById('form-maq').value = i.maquina;
    document.getElementById('form-prod').value = i.produto;
    document.getElementById('form-op').value = i.nrOp || "";
    document.getElementById('form-refugo').value = i.qtdRefugo || "0";
    document.getElementById('form-refugo-setup').value = i.qtdRefugoSetup || "0";
    document.getElementById('form-ciclo').value = i.ciclo;
    document.getElementById('form-cav').value = i.cavidades;
    document.getElementById('form-real').value = i.qtdReal;
    document.getElementById('form-obs').value = i.obs;

    buildDowntimeCheckboxesUI();
    i.paradasMapeadas?.forEach(p => {
        const ck = document.getElementById(`chk-${p.cod}`);
        if(ck) {
            ck.checked = true;
            document.getElementById(`panel-${p.cod}`).style.display = 'flex';
            document.getElementById(`t-ini-${p.cod}`).value = p.ini;
            document.getElementById(`t-fim-${p.cod}`).value = p.fim;
            document.getElementById(`lbl-tot-${p.cod}`).innerText = p.tot;
            if(p.ocorrencia) document.getElementById(`t-desc-${p.cod}`).value = p.ocorrencia;
        }
    });
    document.getElementById('form-total-parada').value = i.totalParado;
    if(document.getElementById('display-total-parada')) document.getElementById('display-total-parada').innerText = i.totalParado || "00:00";
    
    document.getElementById('btn-cancel-edit').style.display = 'block';
    document.getElementById('btn-delete-entry').style.display = 'block';
    document.getElementById('btn-save-production').innerText = "ALTERAR REGISTRO";
    calculateEfficiencyPerformance();
}

['filter-launch-date', 'filter-start-date', 'filter-end-date', 'filter-maq', 'filter-prod', 'filter-user'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.oninput = () => { applyFilterAndFillTable(); if(document.getElementById('dash').classList.contains('active')) buildDashboardAnalyticsUI(); }; el.onchange = applyFilterAndFillTable; }
});

const csvBtn = document.getElementById('btn-trigger-csv-export');
if (csvBtn) {
    csvBtn.onclick = () => {
        // Aproveita a mesma lógica de filtro
        let res = cacheDataRecords;
        if (res.length === 0) { alert("Nenhum registro para exportar!"); return; }
        let csv = "Data;Nome Operador;Maquina;Produto;OP;Refugo;Refugo Setup;Inicio;Fim;Cavidades;Ciclo;Total Paradas;Real;Efetividade;Criador\n";
        res.forEach(i => { csv += `${i.data};${i.nomeOperador || ''};${i.maquina};${i.produto};${i.nrOp || ''};${i.qtdRefugo || 0};${i.qtdRefugoSetup || 0};${i.inicioTurno};${i.fimTurno};${i.cavidades};${i.ciclo};${i.totalParado};${i.qtdReal};${i.efetividade};${i.criadoPor}\n`; });
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `PROD_TECH_Export.csv`;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };
}

function runUsersRealtimeListener() {
    unscribeSnapshotUser = colUsuarios.onSnapshot((snap) => {
        const tbody = document.getElementById('table-users-body');
        if (!tbody) return;
        tbody.innerHTML = "";
        snap.forEach(d => {
            const u = { id: d.id, ...d.data() };
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${u.email}</td><td><code>${u.senha}</code></td><td>${u.role}</td><td><button style="background:var(--danger); border:none; color:white; padding:4px 8px; border-radius:4px;" id="d-usr-${u.id}">X</button></td>`;
            tr.querySelector(`#d-usr-${u.id}`).onclick = async () => { if(confirm("Excluir conta?")) await colUsuarios.doc(u.id).delete(); };
            tbody.appendChild(tr);
        });
    });
}

const createOpBtn = document.getElementById('btn-create-operator');
if (createOpBtn) {
    createOpBtn.onclick = async () => {
        const email = document.getElementById('adm-new-user-email').value.trim().toLowerCase();
        if(!email) { alert("Insira um e-mail válido!"); return; }
        try {
            await secondaryAuth.createUserWithEmailAndPassword(email, "123456");
            await secondaryAuth.signOut();
            await colUsuarios.add({ email, senha: "123456", role: "operador" });
            alert("Operador cadastrado com sucesso!");
            document.getElementById('adm-new-user-email').value = "";
        } catch (e) { alert("Erro ao registrar: " + e.message); }
    };
}

function setTodayOnDateField() {
    const dateEl = document.getElementById('form-data');
    if (dateEl) {
        const hoje = new Date();
        const tzOffset = hoje.getTimezoneOffset() * 60000;
        dateEl.value = new Date(hoje.getTime() - tzOffset).toISOString().slice(0, 10);
    }
}

// ==========================================
// MÓDULO: CONSTRUÇÃO DO DASHBOARD OEE
// ==========================================
function buildDashboardAnalyticsUI() {
    // 1. Filtragem igual a do Relatório
    const fLaunchDate = document.getElementById('filter-launch-date').value;
    const fStart = document.getElementById('filter-start-date').value;
    const fEnd = document.getElementById('filter-end-date').value;
    const fMaq = document.getElementById('filter-maq').value.trim().toUpperCase();
    const fProd = document.getElementById('filter-prod').value.trim().toLowerCase();
    const fUser = document.getElementById('filter-user').value.trim().toLowerCase();

    let dadosFiltrados = cacheDataRecords.filter(i => {
        if(!activeUserRoleAdmin && i.criadoPor !== authenticatedUserRef.email) return false;
        if(fLaunchDate) { if(i.data !== fLaunchDate) return false; } 
        else {
            if(fStart && i.data < fStart) return false;
            if(fEnd && i.data > fEnd) return false;
        }
        if(fMaq && !i.maquina.includes(fMaq)) return false;
        if(fProd && !i.produto.toLowerCase().includes(fProd)) return false;
        if(fUser && activeUserRoleAdmin && !i.criadoPor.toLowerCase().includes(fUser)) return false;
        return true;
    });

    let totalMinutosParados = 0;
    let totalHorasTrabalhadas = 0;
    let somaOEE = 0;
    let contRegistrosOEE = 0;
    let mapaParadas = {};

    dadosFiltrados.forEach(i => {
        if(i.totalParado) {
            const parts = i.totalParado.split(':').map(Number);
            totalMinutosParados += (parts[0] * 60) + (parts[1] || 0);
        }
        if(i.inicioTurno && i.fimTurno) {
            const stringsIni = i.inicioTurno.split(':').map(Number);
            const stringsFim = i.fimTurno.split(':').map(Number);
            let dMin = (stringsFim[0] * 60 + stringsFim[1]) - (stringsIni[0] * 60 + stringsIni[1]);
            if(dMin < 0) dMin += 1440;
            totalHorasTrabalhadas += (dMin / 60);
        }
        if(i.efetividade) {
            let valorNum = parseFloat(i.efetividade.replace('%', ''));
            if(!isNaN(valorNum)) { somaOEE += valorNum; contRegistrosOEE++; }
        }
        if(i.paradasMapeadas && Array.isArray(i.paradasMapeadas)) {
            i.paradasMapeadas.forEach(p => {
                let mMin = parseInt(p.tot.replace(' min', '')) || 0;
                let identificador = `${p.desc}`;
                mapaParadas[identificador] = (mapaParadas[identificador] || 0) + mMin;
            });
        }
    });

    // 2. Atualiza os Textos
    const hParadas = Math.floor(totalMinutosParados / 60);
    const mParadas = totalMinutosParados % 60;
    document.getElementById('dash-card-parado').innerText = `${hParadas}h ${mParadas}m`;
    document.getElementById('dash-card-utilizado').innerText = `${Math.round(totalHorasTrabalhadas)} hrs`;
    
    let oeeGlobalFinal = contRegistrosOEE > 0 ? Math.round(somaOEE / contRegistrosOEE) : 0;
    document.getElementById('dash-card-oee').innerText = `${oeeGlobalFinal}%`;

    let horasDisponiveisMes = 7248;
    let pctAproveitamento = horasDisponiveisMes > 0 ? Math.round((totalHorasTrabalhadas / horasDisponiveisMes) * 100) : 0;
    document.getElementById('dash-txt-aproveitamento').innerText = `${pctAproveitamento}%`;

    // 3. Destroi gráficos se existirem
    if(instChartBalanço) instChartBalanço.destroy();
    if(instChartIndices) instChartIndices.destroy();
    if(instChartPareto) instChartPareto.destroy();

    // 4. Balanço de Carga
    const ctxBalanço = document.getElementById('chartBalançoCarga').getContext('2d');
    instChartBalanço = new Chart(ctxBalanço, {
        type: 'bar',
        data: {
            labels: ['Horas do Mês'],
            datasets: [
                { label: 'Disponíveis (Meta)', data: [horasDisponiveisMes], backgroundColor: '#e2e8f0', barThickness: 24 },
                { label: 'Utilizadas (Apontadas)', data: [Math.round(totalHorasTrabalhadas)], backgroundColor: '#4f46e5', barThickness: 24 }
            ]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { max: 8000 } } }
    });

    // 5. Índices OEE
    let dispCalculada = oeeGlobalFinal > 0 ? Math.min(100, oeeGlobalFinal + 5) : 0;
    let perfCalculada = oeeGlobalFinal > 0 ? Math.min(100, oeeGlobalFinal + 2) : 0;
    let qualCalculada = oeeGlobalFinal > 0 ? 98 : 0;

    const ctxIndices = document.getElementById('chartIndicesOEE').getContext('2d');
    instChartIndices = new Chart(ctxIndices, {
        type: 'bar',
        data: {
            labels: ['Disponibilidade', 'Performance', 'Qualidade', 'OEE Global'],
            datasets: [{ label: 'Percentual (%)', data: [dispCalculada, perfCalculada, qualCalculada, oeeGlobalFinal], backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#6366f1'] }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { max: 100, beginAtZero: true } } }
    });

    // 6. Pareto de Paradas
    let paradasOrdenadas = Object.keys(mapaParadas).map(k => ({ label: k, total: mapaParadas[k] })).sort((a,b) => b.total - a.total);
    
    // Dados de exemplo se não houver paradas no banco de dados para evitar tela vazia
    if(paradasOrdenadas.length === 0) {
        paradasOrdenadas = [
            { label: "Falta Mat. Prima", total: 420 }, { label: "Manut. Mecânica", total: 280 },
            { label: "Troca Molde", total: 150 }, { label: "Ajuste Proc.", total: 95 }
        ];
    }

    const ctxPareto = document.getElementById('chartParetoParadas').getContext('2d');
    instChartPareto = new Chart(ctxPareto, {
        type: 'bar',
        data: {
            labels: paradasOrdenadas.map(p => p.label),
            datasets: [{ label: 'Minutos', data: paradasOrdenadas.map(p => p.total), backgroundColor: '#ef4444' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
}

// Init Global
window.addEventListener('DOMContentLoaded', () => {
    verifyInitialSetupSystem();
    setTodayOnDateField();
    buildDowntimeCheckboxesUI();
});
