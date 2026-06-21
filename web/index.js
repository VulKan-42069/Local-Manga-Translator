// Frontend logic for Local Manga Translator
let bridge;

function setAlignActive(btn) {
    const l = document.getElementById('align-left');
    const c = document.getElementById('align-center');
    const r = document.getElementById('align-right');
    if (l) l.classList.remove('active');
    if (c) c.classList.remove('active');
    if (r) r.classList.remove('active');
    if (btn) btn.classList.add('active');
}

// Application State
let docType = ''; // 'pdf', 'image', 'folder'
let originalDocPath = ''; // C# path of the loaded document
let documentPages = []; // Array of image file paths
let activePageIndex = -1;
let activeImageBase64 = ''; // Base64 of the original active page
let activeImage = null; // Image object of the active page

// Viewport state
let zoomScale = 1.0;
let panOffset = { x: 0, y: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let dragStart = { x: 0, y: 0 };
let activeTool = 'select'; // 'select', 'draw'

// Typeset overlays state
// Keys: page indexes, Values: Array of box objects
let pageOverlays = {};
let selectedBoxId = null;
let isDrawing = false;
let drawRect = { x: 0, y: 0, w: 0, h: 0 };
let isMovingBox = false;
let isResizingBox = false;
let boxDragOffset = { x: 0, y: 0 };

// DOM Elements
const canvasOriginal = document.getElementById('canvas-original');
const canvasTranslated = document.getElementById('canvas-translated');
const ctxOriginal = canvasOriginal.getContext('2d');
const ctxTranslated = canvasTranslated.getContext('2d');
const canvasContainer = document.getElementById('canvas-container');

// Initialize Webview Bridge
window.addEventListener('DOMContentLoaded', async () => {
    // Wait for the host object to become available
    if (window.chrome && window.chrome.webview && window.chrome.webview.hostObjects) {
        bridge = window.chrome.webview.hostObjects.bridge;
    } else {
        console.warn("WebView2 Host Object 'bridge' not found. Running in mock/preview browser mode.");
        setupMockBridge();
    }

    setupEventListeners();
    setupCanvasEvents();
    startOllamaStatusPoll();
    runDiagnosticsSuite(true); // Run quick silent diagnostics at startup
});

// Setup DOM Event Listeners
function setupEventListeners() {
    // File/Folder Loaders
    document.getElementById('btn-load-file').addEventListener('click', async () => {
        const filePath = await bridge.SelectFile();
        if (filePath) {
            loadDocument(filePath);
        }
    });

    document.getElementById('btn-load-folder').addEventListener('click', async () => {
        const folderPath = await bridge.SelectFolder();
        if (folderPath) {
            loadFolder(folderPath);
        }
    });

    // View Mode Toggles
    const modeOrigBtn = document.getElementById('mode-original');
    const modeTransBtn = document.getElementById('mode-translated');
    const modeSplitBtn = document.getElementById('mode-split');

    function clearViewModeClasses() {
        canvasContainer.className = 'canvas-container';
        modeOrigBtn.classList.remove('active');
        modeTransBtn.classList.remove('active');
        modeSplitBtn.classList.remove('active');
    }

    modeOrigBtn.addEventListener('click', () => {
        clearViewModeClasses();
        canvasContainer.classList.add('mode-original-only');
        modeOrigBtn.classList.add('active');
        setTimeout(resetViewport, 50);
    });

    modeTransBtn.addEventListener('click', () => {
        clearViewModeClasses();
        canvasContainer.classList.add('mode-translated-only');
        modeTransBtn.classList.add('active');
        setTimeout(resetViewport, 50);
    });

    modeSplitBtn.addEventListener('click', () => {
        clearViewModeClasses();
        canvasContainer.classList.add('mode-split-screen');
        modeSplitBtn.classList.add('active');
        setTimeout(resetViewport, 50);
    });

    // Diagnostics modal triggers
    document.getElementById('btn-diagnostics').addEventListener('click', () => {
        document.getElementById('diagnostics-modal').classList.remove('hidden');
    });

    document.getElementById('btn-close-diagnostics').addEventListener('click', () => {
        document.getElementById('diagnostics-modal').classList.add('hidden');
    });

    document.getElementById('btn-run-tests').addEventListener('click', () => {
        runDiagnosticsSuite(false);
    });

    // Export current page
    document.getElementById('btn-export').addEventListener('click', exportCurrentPage);

    // Auto-detect and translate page
    document.getElementById('btn-auto-translate').addEventListener('click', autoTranslatePage);

    // Zoom controls
    document.getElementById('btn-zoom-fit').addEventListener('click', zoomToFit);

    // Tab switcher
    const tabEditorBtn = document.getElementById('tab-editor-btn');
    const tabSettingsBtn = document.getElementById('tab-settings-btn');
    const tabEditor = document.getElementById('tab-editor');
    const tabSettings = document.getElementById('tab-settings');

    tabEditorBtn.addEventListener('click', () => {
        tabEditorBtn.classList.add('active');
        tabSettingsBtn.classList.remove('active');
        tabEditor.classList.add('active');
        tabSettings.classList.remove('active');
    });

    tabSettingsBtn.addEventListener('click', () => {
        tabSettingsBtn.classList.add('active');
        tabEditorBtn.classList.remove('active');
        tabSettings.classList.add('active');
        tabEditor.classList.remove('active');
    });

    // Editor fields bindings
    document.getElementById('btn-run-translation').addEventListener('click', runTranslationOnCrop);
    
    document.getElementById('txt-ocr').addEventListener('input', (e) => {
        const box = getSelectedBox();
        if (box) {
            box.originalText = e.target.value;
            redrawCanvases();
            triggerAutosave();
        }
    });

    document.getElementById('txt-translation').addEventListener('input', (e) => {
        const box = getSelectedBox();
        if (box) {
            box.translatedText = e.target.value;
            redrawCanvases();
            triggerAutosave();
        }
    });

    document.getElementById('btn-apply-text').addEventListener('click', () => {
        const box = getSelectedBox();
        if (box) {
            box.originalText = document.getElementById('txt-ocr').value;
            box.translatedText = document.getElementById('txt-translation').value;
            redrawCanvases();
            triggerAutosave();
        }
    });

    document.getElementById('btn-delete-bubble').addEventListener('click', () => {
        const boxes = pageOverlays[activePageIndex] || [];
        pageOverlays[activePageIndex] = boxes.filter(b => b.id !== selectedBoxId);
        selectedBoxId = null;
        updateEditorPanel();
        redrawCanvases();
        triggerAutosave();
    });

    // Mask styling bindings
    document.getElementById('select-mask-shape').addEventListener('change', (e) => {
        const box = getSelectedBox();
        if (box) {
            box.maskType = e.target.value;
            redrawCanvases();
            triggerAutosave();
        }
    });

    const pickerMaskColor = document.getElementById('picker-mask-color');
    const txtMaskColor = document.getElementById('txt-mask-color');
    pickerMaskColor.addEventListener('input', (e) => {
        txtMaskColor.value = e.target.value;
        const box = getSelectedBox();
        if (box) {
            box.maskColor = e.target.value;
            redrawCanvases();
            triggerAutosave();
        }
    });
    txtMaskColor.addEventListener('input', (e) => {
        if (e.target.value.match(/^#[0-9A-Fa-f]{6}$/)) {
            pickerMaskColor.value = e.target.value;
            const box = getSelectedBox();
            if (box) {
                box.maskColor = e.target.value;
                redrawCanvases();
                triggerAutosave();
            }
        }
    });

    const sliderOpacity = document.getElementById('slider-mask-opacity');
    const labelOpacity = document.getElementById('label-mask-opacity');
    sliderOpacity.addEventListener('input', (e) => {
        labelOpacity.textContent = e.target.value;
        const box = getSelectedBox();
        if (box) {
            box.opacity = parseFloat(e.target.value);
            redrawCanvases();
            triggerAutosave();
        }
    });

    // Font typesetting bindings
    const selectFontFamily = document.getElementById('select-font-family');
    const txtCustomFont = document.getElementById('txt-custom-font');
    selectFontFamily.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom') {
            txtCustomFont.classList.remove('hidden');
        } else {
            txtCustomFont.classList.add('hidden');
            const box = getSelectedBox();
            if (box) {
                box.fontFamily = val;
                redrawCanvases();
                triggerAutosave();
            }
        }
    });
    txtCustomFont.addEventListener('input', (e) => {
        const box = getSelectedBox();
        if (box && selectFontFamily.value === 'custom') {
            box.fontFamily = e.target.value;
            redrawCanvases();
            triggerAutosave();
        }
    });

    document.getElementById('num-font-size').addEventListener('input', (e) => {
        const box = getSelectedBox();
        if (box) {
            box.fontSize = parseInt(e.target.value) || 12;
            redrawCanvases();
            triggerAutosave();
        }
    });

    const pickerTextColor = document.getElementById('picker-text-color');
    const txtTextColor = document.getElementById('txt-text-color');
    pickerTextColor.addEventListener('input', (e) => {
        txtTextColor.value = e.target.value;
        const box = getSelectedBox();
        if (box) {
            box.textColor = e.target.value;
            redrawCanvases();
            triggerAutosave();
        }
    });
    txtTextColor.addEventListener('input', (e) => {
        if (e.target.value.match(/^#[0-9A-Fa-f]{6}$/)) {
            pickerTextColor.value = e.target.value;
            const box = getSelectedBox();
            if (box) {
                box.textColor = e.target.value;
                redrawCanvases();
                triggerAutosave();
            }
        }
    });

    document.getElementById('num-line-height').addEventListener('input', (e) => {
        const box = getSelectedBox();
        if (box) {
            box.lineHeight = parseFloat(e.target.value) || 1.2;
            redrawCanvases();
            triggerAutosave();
        }
    });

    // Text Alignment toggles
    const alignLeft = document.getElementById('align-left');
    const alignCenter = document.getElementById('align-center');
    const alignRight = document.getElementById('align-right');
    alignLeft.addEventListener('click', () => {
        setAlignActive(alignLeft);
        const box = getSelectedBox();
        if (box) { box.align = 'left'; redrawCanvases(); triggerAutosave(); }
    });
    alignCenter.addEventListener('click', () => {
        setAlignActive(alignCenter);
        const box = getSelectedBox();
        if (box) { box.align = 'center'; redrawCanvases(); triggerAutosave(); }
    });
    alignRight.addEventListener('click', () => {
        setAlignActive(alignRight);
        const box = getSelectedBox();
        if (box) { box.align = 'right'; redrawCanvases(); triggerAutosave(); }
    });

    document.getElementById('chk-bold').addEventListener('change', (e) => {
        const box = getSelectedBox();
        if (box) {
            box.bold = e.target.checked;
            redrawCanvases();
            triggerAutosave();
        }
    });

    document.getElementById('chk-italic').addEventListener('change', (e) => {
        const box = getSelectedBox();
        if (box) {
            box.italic = e.target.checked;
            redrawCanvases();
            triggerAutosave();
        }
    });

    // Settings elements
    document.getElementById('setting-temperature').addEventListener('input', (e) => {
        document.getElementById('label-temperature').textContent = e.target.value;
    });

    document.getElementById('btn-start-ollama').addEventListener('click', async () => {
        document.getElementById('btn-start-ollama').classList.add('hidden');
        document.getElementById('ollama-status-text').textContent = "STARTING...";
        const started = await bridge.StartOllamaServer();
        checkOllamaStatus();
    });

    // Language selector change triggers immediate translation target update
    document.getElementById('select-target-lang').addEventListener('change', () => {
        // Redraw overlays or update prompt if needed
    });

    window.addEventListener('resize', () => {
        resetViewport();
    });

    // Bulletproof ResizeObserver to handle WPF window rendering layout changes and mode toggles
    const resizeObserver = new ResizeObserver(() => {
        if (activeImage) {
            resetViewport();
        }
    });
    const wrapperOrig = canvasOriginal.parentElement;
    const wrapperTrans = canvasTranslated.parentElement;
    if (wrapperOrig) resizeObserver.observe(wrapperOrig);
    if (wrapperTrans) resizeObserver.observe(wrapperTrans);
}

// Global Document Load
async function loadDocument(filePath) {
    showLoading(true, "Loading document and extracting pages...");
    try {
        const responseJson = await bridge.LoadDocument(filePath);
        const response = JSON.parse(responseJson);

        if (response.error) {
            alert("Error: " + response.error);
            showLoading(false);
            return;
        }

        docType = response.type;
        originalDocPath = response.originalPath;
        documentPages = response.pages;
        activePageIndex = 0;

        // Load project autosave
        const savedProjectJson = await bridge.LoadProject(originalDocPath);
        if (savedProjectJson) {
            try {
                const project = JSON.parse(savedProjectJson);
                pageOverlays = project.pageOverlays || {};
            } catch (e) {
                console.error("Autosave load failed, initializing empty.", e);
                pageOverlays = {};
            }
        } else {
            pageOverlays = {};
        }

        renderPageList();
        await loadPage(0);
    } catch (ex) {
        alert("Fatal error loading file: " + ex.Message);
    } finally {
        showLoading(false);
    }
}

// Load Images from Folder
async function loadFolder(folderPath) {
    showLoading(true, "Scanning folder for images...");
    try {
        const responseJson = await bridge.GetImagesInFolder(folderPath);
        const response = JSON.parse(responseJson);

        if (response.error) {
            alert("Error: " + response.error);
            showLoading(false);
            return;
        }

        docType = response.type;
        originalDocPath = response.originalPath; // The folder path acts as document ID
        documentPages = response.pages;
        activePageIndex = 0;

        // Load project autosave
        const savedProjectJson = await bridge.LoadProject(originalDocPath + "/folder");
        if (savedProjectJson) {
            try {
                const project = JSON.parse(savedProjectJson);
                pageOverlays = project.pageOverlays || {};
            } catch (e) {
                pageOverlays = {};
            }
        } else {
            pageOverlays = {};
        }

        renderPageList();
        await loadPage(0);
    } catch (ex) {
        alert("Fatal error loading folder: " + ex.Message);
    } finally {
        showLoading(false);
    }
}

// Load Page Index
async function loadPage(index) {
    if (index < 0 || index >= documentPages.length) return;
    activePageIndex = index;
    selectedBoxId = null;

    // Highlight selected item in sidebar
    const items = document.querySelectorAll('.page-item');
    items.forEach((item, idx) => {
        if (idx === index) item.classList.add('active');
        else item.classList.remove('active');
    });

    // Read image file via bridge (Base64)
    showLoading(true, `Loading page ${index + 1}...`);
    try {
        const base64Data = await bridge.LoadImageAsBase64(documentPages[index]);
        activeImageBase64 = base64Data;
        
        activeImage = new Image();
        activeImage.onload = () => {
            // Setup canvas sizes
            canvasOriginal.width = activeImage.naturalWidth;
            canvasOriginal.height = activeImage.naturalHeight;
            canvasTranslated.width = activeImage.naturalWidth;
            canvasTranslated.height = activeImage.naturalHeight;
            
            // Set styles of canvas elements in DOM to match original page proportions
            setTimeout(() => {
                resetViewport();
                showLoading(false);
            }, 50);
        };
        activeImage.src = base64Data;
    } catch (e) {
        showLoading(false);
        alert("Error loading page image: " + e);
    }

    updateEditorPanel();
}

// Render Page List in Left Sidebar
function renderPageList() {
    const pageList = document.getElementById('page-list');
    pageList.innerHTML = '';

    document.getElementById('page-count-badge').textContent = documentPages.length;

    if (documentPages.length === 0) {
        pageList.innerHTML = '<div class="empty-state">No pages.</div>';
        return;
    }

    documentPages.forEach((pagePath, index) => {
        const li = document.createElement('li');
        li.className = `page-item ${index === activePageIndex ? 'active' : ''}`;
        
        const filename = pagePath.substring(pagePath.lastIndexOf('/') + 1);

        // Simple thumbnail placeholder
        const thumb = document.createElement('div');
        thumb.className = 'page-thumbnail-placeholder';
        thumb.textContent = index + 1;

        // Load page thumbnail asynchronously
        (async () => {
            try {
                const base64Data = await bridge.LoadImageAsBase64(pagePath);
                if (base64Data) {
                    const img = document.createElement('img');
                    img.className = 'page-thumbnail-img';
                    img.src = base64Data;
                    img.alt = `Page ${index + 1}`;
                    thumb.textContent = '';
                    thumb.appendChild(img);
                }
            } catch (err) {
                console.error("Failed to load thumbnail for page:", index, err);
            }
        })();

        const label = document.createElement('span');
        label.textContent = filename.length > 20 ? filename.substring(0, 17) + "..." : filename;
        label.title = filename;

        li.appendChild(thumb);
        li.appendChild(label);

        li.addEventListener('click', () => {
            if (activePageIndex !== index) {
                loadPage(index);
            }
        });

        pageList.appendChild(li);
    });
}

// Reset camera / zoom factor
function resetViewport() {
    if (!activeImage) return;

    // Resolve visible wrapper from currently active layout class
    const wrapper = (canvasContainer.classList.contains('mode-original-only'))
        ? canvasOriginal.parentElement
        : canvasTranslated.parentElement;

    if (!wrapper || wrapper.clientWidth <= 0 || wrapper.clientHeight <= 0) {
        // If DOM wrapper has not fully rendered or is hidden, schedule a retry
        setTimeout(resetViewport, 50);
        return;
    }

    const padding = 40;
    const maxWidth = wrapper.clientWidth - padding;
    const maxHeight = wrapper.clientHeight - padding;

    const widthScale = maxWidth / activeImage.naturalWidth;
    const heightScale = maxHeight / activeImage.naturalHeight;

    zoomScale = Math.min(widthScale, heightScale, 1.5); // cap zoom fits to 1.5x max
    
    // Center alignment
    panOffset.x = (wrapper.clientWidth - activeImage.naturalWidth * zoomScale) / 2;
    panOffset.y = (wrapper.clientHeight - activeImage.naturalHeight * zoomScale) / 2;

    updateCanvasTransforms();
    redrawCanvases();
}

function zoomToFit() {
    resetViewport();
}

// Update SVG/CSS Transforms of canvases in DOM
function updateCanvasTransforms() {
    const trans = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`;
    canvasOriginal.style.transform = trans;
    canvasOriginal.style.transformOrigin = '0 0';
    canvasTranslated.style.transform = trans;
    canvasTranslated.style.transformOrigin = '0 0';
    
    document.getElementById('hud-zoom').textContent = `${Math.round(zoomScale * 100)}%`;
}

// Redraw Canvases (Original & Typeset overlays)
function redrawCanvases() {
    if (!activeImage) return;

    // 1. Draw Original Image
    ctxOriginal.clearRect(0, 0, canvasOriginal.width, canvasOriginal.height);
    ctxOriginal.drawImage(activeImage, 0, 0);

    // 2. Draw Translated Canvas (Image + Overlay Masks + Typeset Texts)
    ctxTranslated.clearRect(0, 0, canvasTranslated.width, canvasTranslated.height);
    ctxTranslated.drawImage(activeImage, 0, 0);

    const boxes = pageOverlays[activePageIndex] || [];

    // Redraw translation overlays
    boxes.forEach(box => {
        const isSelected = box.id === selectedBoxId;

        // Draw Inpaint/White-out Mask
        if (box.maskType !== 'None') {
            ctxTranslated.save();
            ctxTranslated.globalAlpha = box.opacity;
            ctxTranslated.fillStyle = box.maskColor;

            if (box.maskType === 'Rectangle') {
                ctxTranslated.fillRect(box.x, box.y, box.w, box.h);
            } else if (box.maskType === 'Ellipse') {
                ctxTranslated.beginPath();
                // Draw oval/ellipse mapping coordinates
                ctxTranslated.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, 2 * Math.PI);
                ctxTranslated.fill();
            }
            ctxTranslated.restore();
        }

        // Draw Typeset Text
        if (box.translatedText) {
            ctxTranslated.save();
            
            // Build font styling string
            let fontStyle = '';
            if (box.italic) fontStyle += 'italic ';
            if (box.bold) fontStyle += 'bold ';

            // Calculate optimal font size dynamically to fit within the box bounds
            const fitFontSize = getFitFontSize(ctxTranslated, box.translatedText, box.w - 10, box.h - 10, box.fontSize, box.fontFamily, box.lineHeight, box.bold, box.italic);
            
            ctxTranslated.font = `${fontStyle}${fitFontSize}px "${box.fontFamily}"`;
            ctxTranslated.fillStyle = box.textColor;
            ctxTranslated.textBaseline = 'top';

            // Wrap and render text lines
            wrapText(ctxTranslated, box.translatedText, box.x + 5, box.y + 5, box.w - 10, box.h - 10, fitFontSize * box.lineHeight, box.align);
            ctxTranslated.restore();
        }

        // Draw bounding box borders (interactive editor visual helpers)
        ctxTranslated.save();
        if (isSelected) {
            ctxTranslated.strokeStyle = '#D11B55'; // Ruby red selected borders
            ctxTranslated.lineWidth = 3 / zoomScale; // keep stroke relative to zoom
            ctxTranslated.strokeRect(box.x, box.y, box.w, box.h);

            // Draw handles at corners
            ctxTranslated.fillStyle = '#D11B55';
            const handleSize = 6 / zoomScale;
            ctxTranslated.fillRect(box.x + box.w - handleSize/2, box.y + box.h - handleSize/2, handleSize, handleSize);
        } else {
            ctxTranslated.strokeStyle = 'rgba(209, 17, 85, 0.4)'; // faint red border for other boxes
            ctxTranslated.lineWidth = 1 / zoomScale;
            ctxTranslated.setLineDash([5 / zoomScale, 5 / zoomScale]);
            ctxTranslated.strokeRect(box.x, box.y, box.w, box.h);
        }
        ctxTranslated.restore();
    });

    // Render active drawing box if currently drawing
    if (isDrawing) {
        ctxTranslated.save();
        ctxTranslated.strokeStyle = '#D11B55';
        ctxTranslated.lineWidth = 2 / zoomScale;
        ctxTranslated.setLineDash([3 / zoomScale, 3 / zoomScale]);
        ctxTranslated.strokeRect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
        ctxTranslated.restore();
    }
}

// Canvas Text Word Wrapper Engine (fits text inside bubbles)
function wrapText(context, text, x, y, maxWidth, maxHeight, lineHeight, align) {
    // Split lines on explicit newlines first
    const paragraphs = text.split('\n');
    let yOffset = y;

    for (let k = 0; k < paragraphs.length; k++) {
        const words = paragraphs[k].split(' ');
        let line = '';
        let lines = [];

        for (let n = 0; n < words.length; n++) {
            let testLine = line + words[n] + ' ';
            let metrics = context.measureText(testLine);
            let testWidth = metrics.width;
            if (testWidth > maxWidth && n > 0) {
                lines.push(line);
                line = words[n] + ' ';
            } else {
                line = testLine;
            }
        }
        lines.push(line);

        // Render each wrapped line of the paragraph
        for (let j = 0; j < lines.length; j++) {
            let lineText = lines[j].trim();
            let xOffset = x;

            if (align === 'center') {
                const width = context.measureText(lineText).width;
                xOffset = x + (maxWidth - width) / 2;
            } else if (align === 'right') {
                const width = context.measureText(lineText).width;
                xOffset = x + maxWidth - width;
            }

            if (yOffset + lineHeight <= y + maxHeight + lineHeight/2) {
                context.fillText(lineText, xOffset, yOffset);
            }
            yOffset += lineHeight;
        }
    }
}

// Check if text fits in the given box dimensions at a specific font size
function checkTextFit(context, text, maxWidth, maxHeight, fontSize, lineHeight, fontFamily, bold, italic) {
    context.save();
    let fontStyle = '';
    if (italic) fontStyle += 'italic ';
    if (bold) fontStyle += 'bold ';
    context.font = `${fontStyle}${fontSize}px "${fontFamily}"`;
    context.textBaseline = 'top';

    const paragraphs = text.split('\n');
    let yOffset = 0;

    for (let k = 0; k < paragraphs.length; k++) {
        const words = paragraphs[k].split(' ');
        let line = '';
        let linesCount = 0;

        for (let n = 0; n < words.length; n++) {
            let testLine = line + words[n] + ' ';
            let metrics = context.measureText(testLine.trim());
            let testWidth = metrics.width;
            if (testWidth > maxWidth) {
                if (line === '') {
                    // Single word is wider than box width
                    context.restore();
                    return false;
                }
                linesCount++;
                line = words[n] + ' ';
            } else {
                line = testLine;
            }
        }
        linesCount++;
        yOffset += linesCount * lineHeight;
    }

    context.restore();
    return yOffset <= maxHeight;
}

// Calculate the maximum fitting font size for a text box (decrementing from target size)
function getFitFontSize(context, text, maxWidth, maxHeight, targetFontSize, fontFamily, lineHeightRatio, bold, italic) {
    let size = targetFontSize;
    const minFontSize = 8; // Readable minimum

    while (size > minFontSize) {
        const lineHeight = size * lineHeightRatio;
        if (checkTextFit(context, text, maxWidth, maxHeight, size, lineHeight, fontFamily, bold, italic)) {
            break;
        }
        size--;
    }
    return size;
}

// Canvas Events (Draw Bounding Box, Move, Zoom, Resize)
function setupCanvasEvents() {
    // Drag-Pan Spacebar key handlers
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            isPanning = true;
            activeTool = 'pan';
            canvasTranslated.style.cursor = 'grab';
            e.preventDefault();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            isPanning = false;
            activeTool = 'select';
            canvasTranslated.style.cursor = 'crosshair';
        }
    });

    // Zooming (mouse wheel) inside Viewport
    const viewport = document.getElementById('viewport');
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        // Find visible wrapper to calculate mouse position relative to it
        const wrapper = (canvasContainer.classList.contains('mode-original-only'))
            ? canvasOriginal.parentElement
            : canvasTranslated.parentElement;
            
        if (!wrapper) return;

        const rect = wrapper.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        const newScale = Math.max(0.1, Math.min(10.0, zoomScale * zoomFactor));

        // Shift pan offsets so the point under the mouse remains stationary
        panOffset.x = mouseX - (mouseX - panOffset.x) * (newScale / zoomScale);
        panOffset.y = mouseY - (mouseY - panOffset.y) * (newScale / zoomScale);
        
        zoomScale = newScale;
        updateCanvasTransforms();
        redrawCanvases();
    });

    // MouseDown
    canvasTranslated.addEventListener('mousedown', (e) => {
        const wrapper = (canvasContainer.classList.contains('mode-original-only'))
            ? canvasOriginal.parentElement
            : canvasTranslated.parentElement;
        if (!wrapper) return;
        const rect = wrapper.getBoundingClientRect();
        const mX = (e.clientX - rect.left - panOffset.x) / zoomScale; // mapped to original image coord space
        const mY = (e.clientY - rect.top - panOffset.y) / zoomScale;

        dragStart.x = e.clientX;
        dragStart.y = e.clientY;

        if (activeTool === 'pan' || e.button === 1) { // Pan mode or Middle Click
            isPanning = true;
            panStart.x = e.clientX - panOffset.x;
            panStart.y = e.clientY - panOffset.y;
            canvasTranslated.style.cursor = 'grabbing';
            return;
        }

        // Check if clicked bottom-right resize handle of selected box
        const selectedBox = getSelectedBox();
        if (selectedBox) {
            const handleSize = 10 / zoomScale;
            if (mX >= selectedBox.x + selectedBox.w - handleSize && mX <= selectedBox.x + selectedBox.w + handleSize &&
                mY >= selectedBox.y + selectedBox.h - handleSize && mY <= selectedBox.y + selectedBox.h + handleSize) {
                isResizingBox = true;
                return;
            }
        }

        // Check if clicked inside any existing bounding boxes (Selection / Move)
        const clickedBox = getBoxAtCoordinates(mX, mY);
        if (clickedBox) {
            selectedBoxId = clickedBox.id;
            isMovingBox = true;
            boxDragOffset.x = mX - clickedBox.x;
            boxDragOffset.y = mY - clickedBox.y;
            updateEditorPanel();
            redrawCanvases();
            return;
        }

        // Clicked empty space - start drawing new box
        selectedBoxId = null;
        updateEditorPanel();
        isDrawing = true;
        drawRect.x = mX;
        drawRect.y = mY;
        drawRect.w = 0;
        drawRect.h = 0;
        redrawCanvases();
    });

    // MouseMove
    window.addEventListener('mousemove', (e) => {
        if (!activeImage) return;

        if (isPanning) {
            panOffset.x = e.clientX - panStart.x;
            panOffset.y = e.clientY - panStart.y;
            updateCanvasTransforms();
            return;
        }

        const wrapper = (canvasContainer.classList.contains('mode-original-only'))
            ? canvasOriginal.parentElement
            : canvasTranslated.parentElement;
        if (!wrapper) return;
        const rect = wrapper.getBoundingClientRect();
        const mX = (e.clientX - rect.left - panOffset.x) / zoomScale;
        const mY = (e.clientY - rect.top - panOffset.y) / zoomScale;

        if (isResizingBox) {
            const box = getSelectedBox();
            if (box) {
                // Adjust width and height (min size 10)
                box.w = Math.max(10, mX - box.x);
                box.h = Math.max(10, mY - box.y);
                redrawCanvases();
            }
            return;
        }

        if (isMovingBox) {
            const box = getSelectedBox();
            if (box) {
                box.x = Math.max(0, Math.min(canvasTranslated.width - box.w, mX - boxDragOffset.x));
                box.y = Math.max(0, Math.min(canvasTranslated.height - box.h, mY - boxDragOffset.y));
                redrawCanvases();
            }
            return;
        }

        if (isDrawing) {
            drawRect.w = mX - drawRect.x;
            drawRect.h = mY - drawRect.y;
            redrawCanvases();
        }
    });

    // MouseUp
    window.addEventListener('mouseup', (e) => {
        if (isPanning) {
            isPanning = false;
            if (activeTool === 'pan') {
                canvasTranslated.style.cursor = 'grab';
            } else {
                canvasTranslated.style.cursor = 'crosshair';
            }
            return;
        }

        if (isResizingBox) {
            isResizingBox = false;
            triggerAutosave();
            return;
        }

        if (isMovingBox) {
            isMovingBox = false;
            triggerAutosave();
            return;
        }

        if (isDrawing) {
            isDrawing = false;
            
            // Normalize dimensions (if dragged backwards)
            if (drawRect.w < 0) {
                drawRect.x += drawRect.w;
                drawRect.w = Math.abs(drawRect.w);
            }
            if (drawRect.h < 0) {
                drawRect.y += drawRect.h;
                drawRect.h = Math.abs(drawRect.h);
            }

            // Create box if it has a reasonable size
            if (drawRect.w > 8 && drawRect.h > 8) {
                const newBox = {
                    id: "box_" + Date.now(),
                    x: Math.round(drawRect.x),
                    y: Math.round(drawRect.y),
                    w: Math.round(drawRect.w),
                    h: Math.round(drawRect.h),
                    originalText: '',
                    translatedText: '',
                    maskType: 'Rectangle', // default Rectangle
                    maskColor: '#ffffff',
                    opacity: 1.0,
                    fontFamily: 'Comic Neue',
                    fontSize: 40, // default font size 40
                    textColor: '#000000',
                    lineHeight: 1.2,
                    align: 'center',
                    bold: true,
                    italic: false
                };

                if (!pageOverlays[activePageIndex]) {
                    pageOverlays[activePageIndex] = [];
                }
                pageOverlays[activePageIndex].push(newBox);
                selectedBoxId = newBox.id;
                updateEditorPanel();
                triggerAutosave();
            }

            redrawCanvases();
        }
    });
}

// Check if coordinates click lands inside a box
function getBoxAtCoordinates(x, y) {
    const boxes = pageOverlays[activePageIndex] || [];
    // Go backwards to select the topmost drawn box first
    for (let i = boxes.length - 1; i >= 0; i--) {
        const box = boxes[i];
        if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
            return box;
        }
    }
    return null;
}

// Get the active selected box object
function getSelectedBox() {
    if (!selectedBoxId) return null;
    const boxes = pageOverlays[activePageIndex] || [];
    return boxes.find(b => b.id === selectedBoxId) || null;
}

// Trigger periodic or immediate autosave JSON state
let autosaveTimeout = null;
function triggerAutosave() {
    if (autosaveTimeout) clearTimeout(autosaveTimeout);
    
    // Debounce save by 800ms
    autosaveTimeout = setTimeout(async () => {
        if (!originalDocPath) return;
        const projectData = {
            version: "1.0",
            pageOverlays: pageOverlays
        };
        const jsonStr = JSON.stringify(projectData, null, 2);
        
        let pathId = originalDocPath;
        if (docType === 'folder') {
            pathId = originalDocPath + "/folder";
        }
        await bridge.SaveProject(pathId, jsonStr);
    }, 80000); // 80 seconds fallback or save project
    
    // For local desktop editing, let's write autosaves instantly on major actions
    saveImmediately();
}

async function saveImmediately() {
    if (!originalDocPath) return;
    const projectData = {
        version: "1.0",
        pageOverlays: pageOverlays
    };
    const jsonStr = JSON.stringify(projectData, null, 2);
    let pathId = originalDocPath;
    if (docType === 'folder') {
        pathId = originalDocPath + "/folder";
    }
    await bridge.SaveProject(pathId, jsonStr);
}

// Update settings values in inputs on select box change
function updateEditorPanel() {
    const box = getSelectedBox();
    const infoPanel = document.getElementById('no-bubble-selected');
    const ctrlPanel = document.getElementById('bubble-editor-controls');

    if (!box) {
        infoPanel.classList.remove('hidden');
        ctrlPanel.classList.add('hidden');
        return;
    }

    infoPanel.classList.add('hidden');
    ctrlPanel.classList.remove('hidden');

    // Populate Fields
    document.getElementById('txt-ocr').value = box.originalText || '';
    document.getElementById('txt-translation').value = box.translatedText || '';
    document.getElementById('select-mask-shape').value = box.maskType;
    document.getElementById('picker-mask-color').value = box.maskColor;
    document.getElementById('txt-mask-color').value = box.maskColor;
    document.getElementById('slider-mask-opacity').value = box.opacity;
    document.getElementById('label-mask-opacity').textContent = box.opacity;
    
    // Font styling
    const fontSelect = document.getElementById('select-font-family');
    const customFontInput = document.getElementById('txt-custom-font');
    if (['Comic Neue', 'Arial', 'Impact', 'Times New Roman'].includes(box.fontFamily)) {
        fontSelect.value = box.fontFamily;
        customFontInput.classList.add('hidden');
    } else {
        fontSelect.value = 'custom';
        customFontInput.value = box.fontFamily;
        customFontInput.classList.remove('hidden');
    }
    document.getElementById('num-font-size').value = box.fontSize;
    document.getElementById('picker-text-color').value = box.textColor;
    document.getElementById('txt-text-color').value = box.textColor;
    document.getElementById('num-line-height').value = box.lineHeight;

    // Bold/Italic
    document.getElementById('chk-bold').checked = box.bold;
    document.getElementById('chk-italic').checked = box.italic;

    // Alignment
    const alignBtn = document.getElementById(`align-${box.align}`);
    if (alignBtn) setAlignActive(alignBtn);
}

// Translate a single overlay box using local VLM on crop
// Translate a single overlay box using local VLM on crop (with auto-retry on empty result)
async function translateBoxWithVlm(box, retryCount = 0) {
    if (!activeImage) return false;

    // 1. Create crop in-memory canvas
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = box.w;
    cropCanvas.height = box.h;
    const cropCtx = cropCanvas.getContext('2d');
    
    // Draw the cropped portion from the original image
    cropCtx.drawImage(activeImage, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const cropBase64 = cropCanvas.toDataURL("image/png");
    
    // Strip data header to get clean base64 string for Ollama VLM
    const base64Clean = cropBase64.substring(cropBase64.indexOf(",") + 1);

    // 2. Fetch language selections
    const targetLang = document.getElementById('select-target-lang').value;
    const ollamaModel = document.getElementById('setting-model-name').value;
    const systemPromptTemplate = document.getElementById('setting-system-prompt').value;
    const temperature = parseFloat(document.getElementById('setting-temperature').value);

    const systemPrompt = systemPromptTemplate.replace(/\[TargetLanguage\]/g, targetLang);

    // 3. Construct Ollama Payload (Include OCR text as helper hint for VLM accuracy)
    const ocrHint = box.originalText ? ` The transcribed Japanese text (OCR hint) is: "${box.originalText}".` : "";
    const payload = {
        model: ollamaModel,
        messages: [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: `Translate this speech bubble image.${ocrHint}`,
                images: [base64Clean]
            }
        ],
        stream: false,
        options: {
            temperature: temperature
        },
        format: "json" // Request JSON schema returned directly
    };

    const responseJson = await bridge.CallOllama("/api/chat", JSON.stringify(payload));
    const responseObj = JSON.parse(responseJson);

    if (responseObj.error) {
        throw new Error(responseObj.error);
    }

    // Parse content response
    const messageContent = responseObj.message.content;
    let success = false;

    try {
        // Strip markdown code fences or conversational wrappers
        let cleanContent = messageContent.trim();
        const firstBrace = cleanContent.indexOf('{');
        const lastBrace = cleanContent.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);
        }

        const translationResult = JSON.parse(cleanContent);
        
        let trans = "";
        let jap = "";
        
        // Find keys case-insensitively
        for (const key in translationResult) {
            const k = key.toLowerCase();
            if (k === 'japanese' || k === 'original' || k === 'romaji' || k === 'transcription') {
                jap = translationResult[key];
            } else if (k === 'translation' || k === 'translated' || k === 'english' || k === 'text' || k === 'malay' || k === 'result') {
                trans = translationResult[key];
            }
        }
        
        // Fallback: grab the first key that isn't the transcribed original text
        if (!trans) {
            for (const key in translationResult) {
                const k = key.toLowerCase();
                if (k !== 'japanese' && k !== 'original' && k !== 'romaji' && k !== 'transcription') {
                    trans = translationResult[key];
                    break;
                }
            }
        }

        box.originalText = jap || translationResult.japanese || "";
        box.translatedText = trans || "";

        if (box.translatedText && box.translatedText.trim().length > 0) {
            success = true;
        }
    } catch (jsonErr) {
        // Fallback if model fails JSON formatting
        console.warn("Model did not return clean JSON content.", messageContent);
        box.translatedText = messageContent;
        if (box.translatedText && box.translatedText.trim().length > 0) {
            success = true;
        }
    }

    // Auto-retry once if translation came back empty (heals VRAM warm-up glitches)
    if (!success && retryCount < 1) {
        console.warn("Empty translation returned. Retrying bubble translation in 1.5 seconds...");
        await new Promise(resolve => setTimeout(resolve, 1500));
        return await translateBoxWithVlm(box, retryCount + 1);
    }

    // Fallback: If crop VLM translation is empty/blank after retry, perform a text-only translation using the OCR text
    if (!success && box.originalText && box.originalText.trim().length > 0) {
        console.warn("VLM crop translation empty after retry. Falling back to text-only translation using OCR text:", box.originalText);
        try {
            const textPayload = {
                model: ollamaModel,
                messages: [
                    {
                        role: "system",
                        content: `You are a professional manga translator. Translate the following Japanese text into natural ${targetLang} comic dialogue. Respond ONLY with a JSON object containing a "translation" key (the translated text in ${targetLang}) and a "japanese" key (the original Japanese text). Do not include any other commentary or markdown formatting outside the JSON object.`
                    },
                    {
                        role: "user",
                        content: `Original Japanese text to translate: "${box.originalText}"`
                    }
                ],
                stream: false,
                options: {
                    temperature: 0.2
                },
                format: "json"
            };

            const responseJson = await bridge.CallOllama("/api/chat", JSON.stringify(textPayload));
            const responseObj = JSON.parse(responseJson);

            if (!responseObj.error && responseObj.message && responseObj.message.content) {
                let cleanContent = responseObj.message.content.trim();
                const firstBrace = cleanContent.indexOf('{');
                const lastBrace = cleanContent.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);
                }

                const translationResult = JSON.parse(cleanContent);
                let trans = "";
                let jap = "";

                // Find keys case-insensitively
                for (const key in translationResult) {
                    const k = key.toLowerCase();
                    if (k === 'japanese' || k === 'original' || k === 'romaji' || k === 'transcription') {
                        jap = translationResult[key];
                    } else if (k === 'translation' || k === 'translated' || k === 'english' || k === 'text' || k === 'malay' || k === 'result') {
                        trans = translationResult[key];
                    }
                }

                // Fallback: grab the first key that isn't the transcribed original text
                if (!trans) {
                    for (const key in translationResult) {
                        const k = key.toLowerCase();
                        if (k !== 'japanese' && k !== 'original' && k !== 'romaji' && k !== 'transcription') {
                            trans = translationResult[key];
                            break;
                        }
                    }
                }

                if (trans && trans.trim().length > 0) {
                    box.translatedText = trans;
                    if (jap) {
                        box.originalText = jap;
                    }
                    console.log("Text-only fallback translation success:", trans);
                    success = true;
                }
            }
        } catch (fallbackErr) {
            console.error("Text-only fallback translation failed:", fallbackErr);
        }
    }

    return true;
}

// Crop current bounding box region and call local Gemma 4 VLM
async function runTranslationOnCrop() {
    const box = getSelectedBox();
    if (!box || !activeImage) return;

    showLoading(true, "Extracting bubble crop...");
    try {
        await translateBoxWithVlm(box);
        updateEditorPanel();
        redrawCanvases();
        triggerAutosave();
    } catch (e) {
        alert("Fatal translation error: " + e);
    } finally {
        showLoading(false);
    }
}

// Compile Page Render and Export to disk
async function exportCurrentPage() {
    if (!activeImage) return;

    showLoading(true, "Compiling typeset details and rendering page...");
    try {
        // Create full resolution export canvas
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = activeImage.naturalWidth;
        exportCanvas.height = activeImage.naturalHeight;
        const exportCtx = exportCanvas.getContext('2d');

        // Draw original background image
        exportCtx.drawImage(activeImage, 0, 0);

        // Draw overlays
        const boxes = pageOverlays[activePageIndex] || [];
        boxes.forEach(box => {
            // Draw Mask
            if (box.maskType !== 'None') {
                exportCtx.save();
                exportCtx.globalAlpha = box.opacity;
                exportCtx.fillStyle = box.maskColor;

                if (box.maskType === 'Rectangle') {
                    exportCtx.fillRect(box.x, box.y, box.w, box.h);
                } else if (box.maskType === 'Ellipse') {
                    exportCtx.beginPath();
                    exportCtx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, 2 * Math.PI);
                    exportCtx.fill();
                }
                exportCtx.restore();
            }

            // Draw text
            if (box.translatedText) {
                exportCtx.save();
                let fontStyle = '';
                if (box.italic) fontStyle += 'italic ';
                if (box.bold) fontStyle += 'bold ';

                const fitFontSize = getFitFontSize(exportCtx, box.translatedText, box.w - 10, box.h - 10, box.fontSize, box.fontFamily, box.lineHeight, box.bold, box.italic);
                exportCtx.font = `${fontStyle}${fitFontSize}px "${box.fontFamily}"`;
                exportCtx.fillStyle = box.textColor;
                exportCtx.textBaseline = 'top';

                wrapText(exportCtx, box.translatedText, box.x + 5, box.y + 5, box.w - 10, box.h - 10, fitFontSize * box.lineHeight, box.align);
                exportCtx.restore();
            }
        });

        const exportBase64 = exportCanvas.toDataURL("image/png");

        if (docType === 'pdf') {
            showLoading(true, "Re-compiling multi-page PDF document...");
            // For a PDF, we need to gather all typeset pages. 
            // In a real workflow, if a user exports, they might want to compile all pages. 
            // Let's render ALL pages that have modifications, and fall back to original pages for un-typeset pages!
            const allPagesBase64 = [];
            
            for (let i = 0; i < documentPages.length; i++) {
                showLoading(true, `Rendering page ${i + 1} of ${documentPages.length}...`);
                const pageBase64 = await renderFullPage(i);
                allPagesBase64.push(pageBase64);
            }

            showLoading(true, "Compiling PDF document with PdfSharp...");
            const outputPath = await bridge.ExportTranslatedDocument(originalDocPath, JSON.stringify(allPagesBase64));
            
            const responseObj = JSON.parse(outputPath);
            if (responseObj.error) {
                alert("PDF export failed: " + responseObj.error);
            } else {
                alert("PDF compiled successfully to:\n" + responseObj);
            }
        } else {
            // Single image export
            const outputPath = await bridge.ExportTranslatedDocument(originalDocPath, JSON.stringify([exportBase64]));
            const responseObj = JSON.parse(outputPath);
            if (responseObj.error) {
                alert("Image export failed: " + responseObj.error);
            } else {
                alert("Image exported successfully to:\n" + responseObj);
            }
        }

    } catch (e) {
        alert("Export error: " + e);
    } finally {
        showLoading(false);
    }
}

// Render a full page at full scale to Base64
async function renderFullPage(pageIndex) {
    return new Promise(async (resolve, reject) => {
        try {
            const pagePath = documentPages[pageIndex];
            const base64Data = await bridge.LoadImageAsBase64(pagePath);
            
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                
                ctx.drawImage(img, 0, 0);

                const boxes = pageOverlays[pageIndex] || [];
                boxes.forEach(box => {
                    if (box.maskType !== 'None') {
                        ctx.save();
                        ctx.globalAlpha = box.opacity;
                        ctx.fillStyle = box.maskColor;
                        if (box.maskType === 'Rectangle') {
                            ctx.fillRect(box.x, box.y, box.w, box.h);
                        } else if (box.maskType === 'Ellipse') {
                            ctx.beginPath();
                            ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, 2 * Math.PI);
                            ctx.fill();
                        }
                        ctx.restore();
                    }

                    if (box.translatedText) {
                        ctx.save();
                        let fontStyle = '';
                        if (box.italic) fontStyle += 'italic ';
                        if (box.bold) fontStyle += 'bold ';

                        const fitFontSize = getFitFontSize(ctx, box.translatedText, box.w - 10, box.h - 10, box.fontSize, box.fontFamily, box.lineHeight, box.bold, box.italic);
                        ctx.font = `${fontStyle}${fitFontSize}px "${box.fontFamily}"`;
                        ctx.fillStyle = box.textColor;
                        ctx.textBaseline = 'top';
                        wrapText(ctx, box.translatedText, box.x + 5, box.y + 5, box.w - 10, box.h - 10, fitFontSize * box.lineHeight, box.align);
                        ctx.restore();
                    }
                });

                resolve(canvas.toDataURL("image/png"));
            };
            img.onerror = (err) => reject(err);
            img.src = base64Data;
        } catch (e) {
            reject(e);
        }
    });
}

// Diagnostics / Self-Test Runner
async function runDiagnosticsSuite(silent = false) {
    if (!silent) {
        // Reset status visuals in modal
        const statuses = document.querySelectorAll('.test-status');
        statuses.forEach(s => {
            s.className = 'test-status status-running';
            s.textContent = 'RUNNING';
        });
        const errors = document.querySelectorAll('.test-error');
        errors.forEach(e => e.classList.add('hidden'));
    }

    try {
        const reportJson = await bridge.RunDiagnosticSuite();
        const report = JSON.parse(reportJson);

        if (silent) {
            // Just update background states
            updateOllamaStatusDisplay(report.OllamaConnection);
            return;
        }

        // Update Modal Reports
        updateTestItemVisual('test-ollama', report.OllamaConnection, report.OllamaError);
        updateTestItemVisual('test-model', report.ModelLoaded, report.ModelError);
        updateTestItemVisual('test-vlm', report.VlmInference, report.VlmError, report.VlmInference ? `OK (${report.VlmLatencyMs}ms)` : '');
        updateTestItemVisual('test-pdf', report.PdfEngineOk, report.PdfError);
        updateTestItemVisual('test-ocr', report.OcrEngineOk, report.OcrError);
        updateTestItemVisual('test-disk', report.DiskWriteOk, report.DiskError);

        updateOllamaStatusDisplay(report.OllamaConnection);

    } catch (e) {
        if (!silent) {
            alert("Error running diagnostics: " + e);
        }
    }
}

function updateTestItemVisual(elementId, passed, errorText, customSuccessText = '') {
    const item = document.getElementById(elementId);
    const badge = item.querySelector('.test-status');
    const errPara = item.querySelector('.test-error');

    if (passed) {
        badge.className = 'test-status status-pass';
        badge.textContent = customSuccessText || 'PASS';
        errPara.classList.add('hidden');
    } else {
        badge.className = 'test-status status-fail';
        badge.textContent = 'FAIL';
        errPara.textContent = errorText || 'Unknown error occurred.';
        errPara.classList.remove('hidden');
    }
}

// Update Server Connection indicator in Settings Tab
function updateOllamaStatusDisplay(isOnline) {
    const dot = document.getElementById('ollama-status-dot');
    const label = document.getElementById('ollama-status-text');
    const startBtn = document.getElementById('btn-start-ollama');

    if (isOnline) {
        dot.className = 'status-dot status-online';
        label.textContent = 'CONNECTED';
        startBtn.classList.add('hidden');
    } else {
        dot.className = 'status-dot status-offline';
        label.textContent = 'OFFLINE';
        startBtn.classList.remove('hidden');
    }
}

// Active Ollama pinger status poll (every 6 seconds)
function startOllamaStatusPoll() {
    setInterval(checkOllamaStatus, 6000);
}

async function checkOllamaStatus() {
    try {
        const running = await bridge.IsOllamaRunning();
        if (running) {
            const responding = await bridge.IsOllamaApiResponding();
            updateOllamaStatusDisplay(responding);
        } else {
            updateOllamaStatusDisplay(false);
        }
    } catch (e) {
        updateOllamaStatusDisplay(false);
    }
}

// Loader overlay helper
function showLoading(show, text = "Loading...") {
    const overlay = document.getElementById('loading-overlay');
    const label = document.getElementById('loading-text');
    if (show) {
        label.textContent = text;
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

// Auto detect and translate the entire page using Windows native OCR + Gemma 4
async function autoTranslatePage() {
    if (!activeImage || activePageIndex === -1) {
        alert("Please load a document page first.");
        return;
    }

    showLoading(true, "Running native layout analysis and OCR...");
    try {
        const pagePath = documentPages[activePageIndex];
        const resultJson = await bridge.AutoDetectText(pagePath);
        const blocks = JSON.parse(resultJson);

        if (blocks.error) {
            alert("OCR Detection failed: " + blocks.error);
            showLoading(false);
            return;
        }

        if (blocks.length === 0) {
            alert("No speech bubbles or text lines detected on this page.");
            showLoading(false);
            return;
        }

        showLoading(true, `Detected ${blocks.length} text areas. Creating overlays...`);

        // Initialize page overlays if empty
        if (!pageOverlays[activePageIndex]) {
            pageOverlays[activePageIndex] = [];
        }

        const newBoxes = [];
        const baseTime = Date.now();

        blocks.forEach((block, index) => {
            // Check if there is already a box with overlapping coordinates to avoid duplication
            const overlap = (pageOverlays[activePageIndex] || []).some(b => {
                const overlapX = Math.max(b.x, block.x) < Math.min(b.x + b.w, block.x + block.w);
                const overlapY = Math.max(b.y, block.y) < Math.min(b.y + b.h, block.y + block.h);
                return overlapX && overlapY;
            });

            if (!overlap) {
                // Determine layout-based font size
                const fontSize = 40;
                const newBox = {
                    id: "box_" + baseTime + "_" + index + "_" + Math.random().toString(36).substr(2, 5),
                    x: Math.round(block.x),
                    y: Math.round(block.y),
                    w: Math.round(block.w),
                    h: Math.round(block.h),
                    originalText: block.text,
                    translatedText: 'Translating...',
                    maskType: 'Rectangle', // default Rectangle
                    maskColor: '#ffffff',
                    opacity: 1.0,
                    fontFamily: 'Comic Neue',
                    fontSize: fontSize,
                    textColor: '#000000',
                    lineHeight: 1.2,
                    align: 'center',
                    bold: true,
                    italic: false
                };
                pageOverlays[activePageIndex].push(newBox);
                newBoxes.push(newBox);
            }
        });

        if (newBoxes.length === 0) {
            alert("All detected text bubbles are already overlaid.");
            showLoading(false);
            redrawCanvases();
            return;
        }

        redrawCanvases();

        // 2. Loop and translate each block sequentially using local VLM image-to-text
        const targetLang = document.getElementById('select-target-lang').value;
        for (let i = 0; i < newBoxes.length; i++) {
            const box = newBoxes[i];
            showLoading(true, `Auto-translating bubble ${i + 1} of ${newBoxes.length} into ${targetLang}...`);

            try {
                await translateBoxWithVlm(box);
            } catch (err) {
                console.error("Auto-translate VLM call error:", err);
                box.translatedText = "[Error]";
            }

            // Redraw page incrementally as bubbles translate!
            redrawCanvases();
        }

        triggerAutosave();
        playSuccessSound();
        alert(`Auto-translation complete! Translated ${newBoxes.length} bubbles.`);

    } catch (ex) {
        alert("Auto-translation error: " + ex);
    } finally {
        showLoading(false);
        updateEditorPanel();
    }
}

// Setup Mock Bridge when testing in standard browser (fallback for debug)
function setupMockBridge() {
    bridge = {
        SelectFile: async () => 'C:/manga/test_chapter.pdf',
        SelectFolder: async () => 'C:/manga/raw_pages',
        LoadDocument: async (path) => JSON.stringify({
            type: 'pdf',
            originalPath: path,
            pages: ['C:/manga/page_0.png', 'C:/manga/page_1.png']
        }),
        GetImagesInFolder: async (path) => JSON.stringify({
            type: 'folder',
            originalPath: path,
            pages: ['C:/manga/page_0.png', 'C:/manga/page_1.png']
        }),
        LoadImageAsBase64: async (path) => {
            // Return 1x1 white PNG as dummy fallback
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        },
        LoadProject: async () => '',
        SaveProject: async () => true,
        CallOllama: async () => JSON.stringify({ message: { content: '{"japanese":"こんにちは","translation":"Hello"}' } }),
        ExportTranslatedDocument: async () => JSON.stringify('C:/manga/test_chapter_translated.pdf'),
        IsOllamaRunning: () => true,
        IsOllamaApiResponding: async () => true,
        StartOllamaServer: async () => true,
        RunDiagnosticSuite: async () => JSON.stringify({
            OllamaConnection: true,
            ModelLoaded: true,
            VlmInference: true,
            VlmLatencyMs: 350,
            PdfEngineOk: true,
            DiskWriteOk: true
        })
    };
}

// Sound effect synthesizer using Web Audio API (crisp, professional system success chime)
function playSuccessSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const playTone = (freq, startTime, duration, volume) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);
            gain.gain.setValueAtTime(volume, startTime);
            gain.gain.exponentialRampToValueAtTime(0.00001, startTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        };
        const now = ctx.currentTime;
        // Rising notification chime: G5 (783.99 Hz) to C6 (1046.50 Hz)
        playTone(783.99, now, 0.12, 0.08);
        playTone(1046.50, now + 0.07, 0.22, 0.08);
    } catch (e) {
        console.warn("Audio Context failed to initialize: ", e);
    }
}

// Custom Alert Dialog implementation
function showAlert(message) {
    const modal = document.getElementById('custom-alert');
    const msgPara = document.getElementById('custom-alert-message');
    msgPara.textContent = message;
    modal.classList.remove('hidden');
}

// Hide custom alert dialog
function hideAlert() {
    const modal = document.getElementById('custom-alert');
    modal.classList.add('hidden');
}

// Override default browser alert
window.alert = showAlert;

// Setup alert events
document.getElementById('btn-alert-ok').addEventListener('click', hideAlert);
document.getElementById('btn-close-alert').addEventListener('click', hideAlert);
