let canvas = document.querySelector('canvas');
let ctx = canvas.getContext('2d');
let drawing = false;
let paintOpen = false;
let tool = 'pen';
let undoStack = [];

// 1. CANVAS BAŞLATMA
function initCanvas() {
    canvas.width = window.innerWidth - 100; 
    canvas.height = window.innerHeight;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

window.addEventListener('resize', initCanvas);
initCanvas();

// 2. ÇİZİM SİSTEMİ
canvas.addEventListener('mousedown', (e) => {
    if(!paintOpen) return;
    drawing = true;
    saveState();
    ctx.beginPath();
    const rect = canvas.getBoundingClientRect();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    applyStyles();
});

canvas.addEventListener('mousemove', (e) => {
    if(!drawing || !paintOpen) return;
    const rect = canvas.getBoundingClientRect();
    ctx.globalCompositeOperation = (tool === 'eraser') ? 'destination-out' : 'source-over';
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
});

canvas.addEventListener('mouseup', () => drawing = false);

function applyStyles() {
    const color = document.getElementById('p-color').value;
    const width = document.getElementById('p-width').value;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowBlur = (tool === 'neon') ? 20 : 0;
    ctx.shadowColor = color;
    ctx.globalAlpha = (tool === 'marker') ? 0.4 : 1.0;
}

// 3. GELİŞMİŞ SÜRÜKLEME SİSTEMİ (Hata Düzeltildi)
function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const targetHandle = handle || element;

    targetHandle.onmousedown = (e) => {
        e = e || window.event;
        if (e.target.classList.contains('c-btn')) return; // Butonlara basınca sürükleme yapma
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
        element.style.transition = 'none'; // Sürüklerken gecikmeyi önle
    };

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        element.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    }
}

// Menü ve Araçları Sürüklenebilir Yap
const pMenu = document.getElementById('paint-menu');
makeDraggable(pMenu, document.getElementById('paint-handle'));

// 4. GEOMETRİ ARAÇLARI
function toggleMathTool(toolId) {
    const el = document.getElementById(toolId);
    if (!el) return;
    
    if (el.style.display === 'none' || el.style.display === '') {
        el.style.display = 'block';
        el.style.top = "200px";
        el.style.left = "300px";
        
        if(toolId === 'ruler') {
            el.style.width = '550px';
            el.style.height = 'auto';
        } else {
            el.style.width = '380px';
            el.style.height = 'auto';
        }
        
        el.dataset.rotation = 0;
        el.dataset.scale = 1.0;
        updateToolTransform(el);
        makeDraggable(el, el.querySelector('.tool-ctrl'));
    } else {
        el.style.display = 'none';
    }
}

function toolRotate(e, toolId) {
    e.stopPropagation();
    const el = document.getElementById(toolId);
    let r = parseInt(el.dataset.rotation || 0);
    r = (r + 15) % 360;
    el.dataset.rotation = r;
    updateToolTransform(el);
}

function toolScale(e, toolId) {
    e.stopPropagation();
    const el = document.getElementById(toolId);
    let s = parseFloat(el.dataset.scale || 1.0);
    s = (s >= 1.6) ? 0.6 : s + 0.2;
    el.dataset.scale = s;
    updateToolTransform(el);
}

function updateToolTransform(el) {
    const r = el.dataset.rotation || 0;
    const s = el.dataset.scale || 1;
    el.style.transform = `rotate(${r}deg) scale(${s})`;
}

// 5. MODLAR VE YARDIMCI ARAÇLAR
function setBoardMode(mode) {
    const layer = document.getElementById('draw-layer');
    layer.style.backgroundImage = 'none';
    layer.classList.add('active'); 
    layer.style.backgroundSize = '30px 30px';

    const colors = {
        white: '#ffffff',
        transparent: 'transparent',
        lined: '#ffffff',
        grid: '#ffffff'
    };
    
    layer.style.backgroundColor = colors[mode];
    
    if (mode === 'lined') {
        layer.style.backgroundImage = 'linear-gradient(#e0e0ff 1px, transparent 1px)';
        layer.style.backgroundSize = '100% 35px';
    } else if (mode === 'grid') {
        layer.style.backgroundImage = 'linear-gradient(#eee 1px, transparent 1px), linear-gradient(90deg, #eee 1px, transparent 1px)';
    }
}

function togglePaintMenu() {
    paintOpen = !paintOpen;
    pMenu.style.display = paintOpen ? 'flex' : 'none';
    document.getElementById('draw-layer').classList.toggle('active', paintOpen);
    if(paintOpen) initCanvas();
}

function setTool(t) {
    tool = t;
    document.querySelectorAll('.t-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('t-' + t)?.classList.add('active');
}

function saveState() {
    if (undoStack.length > 30) undoStack.shift();
    undoStack.push(canvas.toDataURL());
}

function undo() {
    if (undoStack.length > 0) {
        let img = new Image();
        img.src = undoStack.pop();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
    }
}

function clearCanvas() {
    if(confirm("Tüm sayfayı temizle?")) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        undoStack = [];
    }
}