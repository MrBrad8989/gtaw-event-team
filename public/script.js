let existingEvents = [];
const statusMap = {
    pending: "PENDIENTE",
    accepted: "ACEPTADO",
    rejected: "RECHAZADO"
};

/* --- NAVEGACIÓN PRINCIPAL --- */
function navigateTo(sectionId) {
    // 1. Ocultamos todo
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    
    // 2. Si es una sección interna (no dashboard), la mostramos
    if (sectionId !== 'dashboard') {
        const target = document.getElementById(sectionId);
        if(target) target.classList.add('active');
        
        // Cargar datos si es necesario
        if (sectionId === 'list-events-section') loadEvents();
    } else {
        // 3. Si es volver al Dashboard, mostramos el dashboard original
        document.getElementById('dashboard-main').classList.add('active');
        loadEvents(); // Recargar stats
    }
}

// Función para cerrar una sección y volver al Dashboard (La acción de la X)
function closeSection() {
    navigateTo('dashboard');
}

/* --- UTILIDADES FORMULARIO --- */
function toggleField(id, val) {
    document.getElementById(id).style.display = (val === 'true') ? 'block' : 'none';
}

/* --- MODAL DETALLES (POPUP) --- */
function closeModal(e) {
    if (!e || e.target.classList.contains('modal-overlay') || e.target.classList.contains('modal-close') || e.target.tagName === 'BUTTON') {
        document.getElementById('detailsModal').style.display = 'none';
    }
}

function openModal(evt) {
    document.getElementById('modalTitle').innerText = evt.title;
    document.getElementById('modalTicketId').innerText = '#' + evt.id;
    document.getElementById('modalUser').innerText = evt.userId;
    document.getElementById('modalDesc').innerText = evt.description;
    
    const dateObj = new Date(evt.date);
    document.getElementById('modalDate').innerText = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    const statusBadge = document.getElementById('modalStatus');
    statusBadge.className = `badge badge-${evt.status}`;
    statusBadge.innerText = statusMap[evt.status] || evt.status;

    // Flyer
    const flyerImg = document.getElementById('modalFlyer');
    if (evt.flyerPath) {
        const cleanPath = evt.flyerPath.replace(/^public[\\/]/, '').replace(/\\/g, '/');
        flyerImg.src = cleanPath;
        flyerImg.style.display = 'block';
    } else {
        flyerImg.style.display = 'none';
    }

    // Coches
    const carsSec = document.getElementById('modalCarsSection');
    if(evt.needsCars) {
        carsSec.style.display = 'block';
        document.getElementById('modalCarsDesc').innerText = evt.carsDesc;
    } else { carsSec.style.display = 'none'; }

    // Radio
    const radioSec = document.getElementById('modalRadioSection');
    radioSec.style.display = evt.needsRadio ? 'block' : 'none';

    // Mapping
    const mapSec = document.getElementById('modalMappingSection');
    if(evt.needsMapping) {
        mapSec.style.display = 'block';
        document.getElementById('modalMappingDesc').innerText = evt.mappingDesc;
        const gallery = document.getElementById('modalMappingGallery');
        gallery.innerHTML = '';
        if(evt.mappingFiles && evt.mappingFiles.length > 0) {
            evt.mappingFiles.forEach(pathStr => {
                const cleanMapPath = pathStr.replace(/^public[\\/]/, '').replace(/\\/g, '/');
                const img = document.createElement('img');
                img.src = cleanMapPath;
                img.className = 'mapping-thumb';
                img.onclick = () => window.open(cleanMapPath, '_blank');
                gallery.appendChild(img);
            });
        } else {
            gallery.innerHTML = '<span style="color:#555;">Sin fotos.</span>';
        }
    } else { mapSec.style.display = 'none'; }

    // Rechazo
    const rejectSec = document.getElementById('modalRejectSection');
    if(evt.status === 'rejected') {
        rejectSec.style.display = 'block';
        document.getElementById('modalRejectReason').innerText = evt.reason || 'Sin motivo especificado.';
    } else { rejectSec.style.display = 'none'; }

    document.getElementById('detailsModal').style.display = 'flex';
}

/* --- CARGAR DATOS --- */
async function loadEvents() {
    try {
        const res = await fetch('/api/eventos');
        const data = await res.json();
        existingEvents = data;

        // Stats del Dashboard
        document.getElementById('count-total').innerText = data.length;
        document.getElementById('count-pending').innerText = data.filter(e => e.status === 'pending').length;
        document.getElementById('count-accepted').innerText = data.filter(e => e.status === 'accepted').length;
        document.getElementById('count-rejected').innerText = data.filter(e => e.status === 'rejected').length;

        // Tabla del Historial
        const tbody = document.querySelector('#eventsTable tbody');
        if(tbody) {
            tbody.innerHTML = '';
            data.sort((a,b) => b.timestamp - a.timestamp);
            data.forEach(evt => {
                let statusClass = `badge badge-${evt.status}`;
                const translatedStatus = statusMap[evt.status] || evt.status;
                const dateObj = new Date(evt.date);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="color:white; font-weight:bold;">${evt.title}</td>
                    <td>${dateObj.toLocaleDateString()}</td>
                    <td><span class="${statusClass}">${translatedStatus}</span></td>
                    <td style="font-family:monospace; color:#aaa;">#${evt.id}</td>
                `;
                tr.onclick = () => openModal(evt);
                tbody.appendChild(tr);
            });
        }
    } catch (e) { console.error(e); }
}

/* --- EVENT LISTENERS --- */
document.getElementById('dateInput').addEventListener('change', function() {
    const date = new Date(this.value);
    if(date.getMinutes() !== 0 && date.getMinutes() !== 30) {
        alert("Solo horas en punto o y media.");
        this.value = '';
        return;
    }
    const isTaken = existingEvents.some(evt => evt.status !== 'rejected' && new Date(evt.date).getTime() === date.getTime());
    document.getElementById('dateError').style.display = isTaken ? 'block' : 'none';
    if(isTaken) this.value = '';
});

document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await fetch('/api/evento', { method: 'POST', body: fd });
    if(res.ok) {
        alert('Enviado. Se ha creado un ticket en Discord.');
        e.target.reset();
        document.getElementById('carsDetails').style.display = 'none';
        document.getElementById('mappingDetails').style.display = 'none';
        
        // Reset Preview
        document.getElementById('previewTitle').textContent = 'Título del Evento';
        document.getElementById('previewDesc').textContent = 'La descripción aparecerá aquí...';
        document.getElementById('previewDate').textContent = '--/--/---- --:--';
        document.getElementById('previewImageContainer').style.display = 'none';
        document.getElementById('previewImageImg').src = '';

        navigateTo('list-events-section'); // Ir al historial tras crear
    } else {
        const err = await res.json();
        alert(err.error);
    }
});

// Inicializar
loadEvents();

/* --- VISTA PREVIA (MARKDOWN) --- */
const formTitle = document.getElementById('inputTitle');
const formDesc = document.getElementById('inputDesc');
const formDate = document.getElementById('dateInput');
const formFlyer = document.getElementById('inputFlyer');

const prevTitle = document.getElementById('previewTitle');
const prevDesc = document.getElementById('previewDesc');
const prevDate = document.getElementById('previewDate');
const prevImgCont = document.getElementById('previewImageContainer');
const prevImg = document.getElementById('previewImageImg');

function parseDiscordMarkdown(text) {
    if(!text) return '';
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.*?)__/g, '<u>$1</u>');
    html = html.replace(/~~(.*?)~~/g, '<s>$1</s>');
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    return html;
}

if(formTitle) formTitle.addEventListener('input', (e) => prevTitle.textContent = e.target.value || 'Título del Evento');
if(formDesc) formDesc.addEventListener('input', (e) => prevDesc.innerHTML = parseDiscordMarkdown(e.target.value || 'La descripción aparecerá aquí...'));
if(formDate) formDate.addEventListener('change', (e) => {
    if(e.target.value) {
        const d = new Date(e.target.value);
        prevDate.textContent = d.toLocaleDateString('es-ES', {year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'});
    } else prevDate.textContent = '--/--/---- --:--';
});
if(formFlyer) formFlyer.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if(file) {
        const reader = new FileReader();
        reader.onload = (evt) => { prevImg.src = evt.target.result; prevImgCont.style.display = 'block'; }
        reader.readAsDataURL(file);
    } else { prevImg.src = ''; prevImgCont.style.display = 'none'; }
});