var ASSETS={arte1:"https://cdn.prod.website-files.com/65ce205a9737be84d29798b1/6a6265794018f0ce7b5e3734_arte_1.webp",arte2:"https://cdn.prod.website-files.com/65ce205a9737be84d29798b1/6a6265798626cb95132b3eb2_arte_2.webp",arte3:"https://cdn.prod.website-files.com/65ce205a9737be84d29798b1/6a626579a0fcb4267ce43353_arte_3.webp",arte4:"https://cdn.prod.website-files.com/65ce205a9737be84d29798b1/6a67793ff7abef9a104fa719_arte_4.webp",arte5:"https://cdn.prod.website-files.com/65ce205a9737be84d29798b1/6a67793fcaf5ac7ca88e0a42_arte_5.webp",arte6:"https://cdn.prod.website-files.com/65ce205a9737be84d29798b1/6a67793f3fd95dc77be450c9_arte_6.webp",plantilla:"https://cdn.prod.website-files.com/65ce205a9737be84d29798b1/6a6265799156ec8b9eef0bff_plantilla.webp",textura:"https://cdn.prod.website-files.com/65ce205a9737be84d29798b1/6a626579cc94f5cb55744f4d_textura.webp"};
/* ==========================================================================
   The Hayley Williams Show — Generador de portada del tour
   Flujo: 1) subir foto  2) reencuadrar  3) elegir portada  4) resultado
   Espera un objeto global ASSETS con arte1..arte6, plantilla, textura.
   ========================================================================== */
(function(){
'use strict';

/* ---------- Constantes de composición ---------------------------------- */
var FINAL_W = 1080, FINAL_H = 1920;      // historia
var SUB_W = 902, SUB_H = 1275;           // hueco de plantilla.png
var OX = 89, OY = 143;                    // posición del hueco (centrado en x)

/* Hueco de la cara dentro del sub-compuesto 902x1275.
   Los 6 artes comparten el mismo recorte: verificado sobre el canal alfa,
   los huecos de arte_1..arte_6 entran todos en este cuadrado con margen. */
var FACE = { cx: 458, cy: 390, half: 84 };
function faceFor(){ return FACE; }

var ARTE_SRC = [ASSETS.arte1,ASSETS.arte2,ASSETS.arte3,ASSETS.arte4,ASSETS.arte5,ASSETS.arte6];

/* ---------- Utilidades ------------------------------------------------- */
var $ = function(s,r){ return (r||document).querySelector(s); };
var $$ = function(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function loadImage(src){
  // Los artes/plantilla/textura se dibujan en canvas y se exportan. Si vienen
  // de otro dominio (CDN) hace falta crossOrigin + cabeceras CORS del CDN para
  // que el canvas no quede "contaminado". Si el CDN no manda CORS, se reintenta
  // sin crossOrigin (la imagen se ve igual; solo podría fallar la exportación).
  return new Promise(function(res,rej){
    function attempt(useCross){
      var im = new Image();
      if(useCross) im.crossOrigin = 'anonymous';
      im.onload = function(){ res(im); };
      im.onerror = function(){ if(useCross) attempt(false); else rej(new Error('No se pudo cargar un recurso')); };
      im.decoding = 'async';
      im.src = src;
    }
    attempt(true);
  });
}

/* ---------- Estado ----------------------------------------------------- */
var state = {
  arteIndex: 0,
  arteImgs: [],
  plantillaImg: null,
  texturaImg: null,
  sourceBitmap: null,
  crop: { tx:0, ty:0, scale:1, angle:0 },
  base: { w:0, h:0 },
  previews: null,       // 6 data URLs con la cara ya aplicada
  previewSig: '',       // firma del recorte con el que se generaron
  finalBlob: null
};

/* ---------- Navegación ------------------------------------------------- */
function show(id){
  $$('.screen').forEach(function(s){ s.classList.toggle('is-active', s.id===id); });
  window.scrollTo(0,0);
  if(id==='s3' && cropCanvas && state.sourceBitmap){
    requestAnimationFrame(function(){ resizeCropCanvas(); renderCrop(); });
  }
}

/* ---------- Overlay ---------------------------------------------------- */
var busyEl;
function busy(on,txt){
  if(!busyEl) return;
  if(txt) $('.busy-box',busyEl).textContent = txt;
  busyEl.classList.toggle('show', !!on);
}
/* Ejecuta fn dejando pintar antes el overlay */
function afterPaint(fn){
  requestAnimationFrame(function(){ requestAnimationFrame(fn); });
}

/* ======================================================================
   PASO 1 — Subir foto o sacarla con la cámara (pantalla s2)
   ====================================================================== */
/* Ya no se rechaza por peso: si la foto es grande se reduce la resolución
   (manteniendo proporción). Nada se sube a un servidor, así que alcanza con
   acotar el lado mayor para que no pese en memoria ni trabe el navegador.  */
var MAX_SIDE = 1600;

function normalizeSource(bmp){
  var big = Math.max(bmp.width, bmp.height);
  if(big <= MAX_SIDE) return bmp;
  var s = MAX_SIDE / big;
  var w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  var cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  var c = cv.getContext('2d');
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(bmp, 0, 0, w, h);
  if(bmp.close) { try{ bmp.close(); }catch(_){} }
  return cv;   // un canvas sirve igual que un bitmap para drawImage
}

/* Toma cualquier fuente ya cargada y arranca el reencuadre */
function useSource(bmp){
  state.sourceBitmap = normalizeSource(bmp);
  state.previews = null; state.previewSig = '';
  initCrop();
  busy(false);
  show('s3');
}

function setupUpload(){
  var input = $('#fileInput'), camInput = $('#camInput'), drop = $('#drop'), err = $('#fileErr');
  function fail(msg){ err.textContent = msg; err.classList.add('show'); }
  function clearErr(){ err.classList.remove('show'); }

  function handle(file){
    clearErr();
    if(!file) return;
    if(file.type && file.type.indexOf('image/') !== 0){
      fail('Ese archivo no es una imagen. Usá JPG, PNG o WEBP.'); return;
    }
    busy(true,'Preparando foto…');
    loadCorrected(file).then(function(bmp){
      useSource(bmp);
    }).catch(function(){
      busy(false);
      fail('No se pudo abrir la imagen. Probá con otro archivo.');
    });
  }

  input.addEventListener('change', function(){ handle(input.files && input.files[0]); input.value=''; });
  camInput.addEventListener('change', function(){ handle(camInput.files && camInput.files[0]); camInput.value=''; });

  drop.addEventListener('click', function(){ input.click(); });
  drop.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); input.click(); } });
  ['dragenter','dragover'].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave','drop'].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function(e){
    handle(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  // Botones directos de mobile
  var galM = $('#btnGalleryM');
  if(galM) galM.addEventListener('click', function(){ input.click(); });

  setupCamera(handle);
}

/* ---------- Cámara ------------------------------------------------------
   Si el navegador permite cámara en vivo (https), se abre acá mismo.
   Si no (por ejemplo abriendo el archivo con file://), cae al input con
   capture, que en el celular abre la cámara nativa del sistema.          */
function setupCamera(handleFile){
  var camEl = $('#cam'), video = $('#camVideo');
  var btn = $('#btnCamera'), shot = $('#camShot'), cancel = $('#camCancel');
  var camInput = $('#camInput');
  var stream = null;

  function canLiveCamera(){
    return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  function closeCamera(){
    if(stream){ stream.getTracks().forEach(function(t){ t.stop(); }); stream = null; }
    video.srcObject = null;
    camEl.classList.remove('show');
  }
  function openCamera(){
    if(!canLiveCamera()){ camInput.click(); return; }
    busy(true,'Abriendo cámara…');
    navigator.mediaDevices.getUserMedia({
      video:{ facingMode:'user', width:{ideal:1280}, height:{ideal:1280} }, audio:false
    }).then(function(s){
      stream = s; video.srcObject = s;
      var p = video.play(); if(p && p.catch) p.catch(function(){});
      busy(false);
      camEl.classList.add('show');
    }).catch(function(){
      busy(false);
      camInput.click();   // permiso denegado o sin cámara: se usa la nativa
    });
  }

  btn.addEventListener('click', function(e){
    e.preventDefault(); e.stopPropagation();   // no dispara el file picker del drop
    openCamera();
  });
  var btnM = $('#btnCameraM');
  if(btnM) btnM.addEventListener('click', function(e){ e.preventDefault(); openCamera(); });
  cancel.addEventListener('click', closeCamera);
  camEl.addEventListener('click', function(e){ if(e.target===camEl) closeCamera(); });
  document.addEventListener('keydown', function(e){
    if(e.key==='Escape' && camEl.classList.contains('show')) closeCamera();
  });

  shot.addEventListener('click', function(){
    var vw = video.videoWidth, vh = video.videoHeight;
    if(!vw || !vh){ closeCamera(); return; }
    var side = Math.min(vw, vh);            // recorte cuadrado centrado
    var cv = document.createElement('canvas');
    cv.width = side; cv.height = side;
    var c = cv.getContext('2d');
    c.translate(side, 0); c.scale(-1, 1);   // espejo, como se ve en pantalla
    c.drawImage(video, (vw-side)/2, (vh-side)/2, side, side, 0, 0, side, side);
    closeCamera();
    busy(true,'Preparando foto…');
    afterPaint(function(){ useSource(cv); });
  });
}

/* Corrección de orientación EXIF con createImageBitmap; fallback a <img>. */
function loadCorrected(file){
  if('createImageBitmap' in window){
    return createImageBitmap(file, { imageOrientation:'from-image' })
      .catch(function(){ return createImageBitmap(file); })
      .catch(function(){ return imgFallback(file); });
  }
  return imgFallback(file);
}
function imgFallback(file){
  return new Promise(function(res,rej){
    var url = URL.createObjectURL(file);
    var im = new Image();
    im.onload = function(){ res(im); };
    im.onerror = function(){ URL.revokeObjectURL(url); rej(new Error('img')); };
    im.src = url;
  });
}

/* ======================================================================
   PASO 2 — Reencuadrar (pantalla s3)
   ====================================================================== */
var S = 1000;   // unidades lógicas de la stage cuadrada
var cropCanvas, cropCtx, cropRect;

function initCrop(){
  var img = state.sourceBitmap;
  var cover = Math.max(S / img.width, S / img.height);   // llena el cuadrado sin deformar
  state.base.w = img.width * cover;
  state.base.h = img.height * cover;
  state.crop = { tx:0, ty:0, scale:1, angle:0 };
  var z=$('#zoomRange'), r=$('#rotRange');
  if(z) z.value = 100;
  if(r) r.value = 0;
  requestAnimationFrame(function(){ resizeCropCanvas(); renderCrop(); });
}

function resizeCropCanvas(){
  if(!cropCanvas) return;
  cropRect = cropCanvas.getBoundingClientRect();
  if(!cropRect.width) return;
  var dpr = Math.min(window.devicePixelRatio || 1, 3);
  var px = Math.max(1, Math.round(cropRect.width * dpr));
  cropCanvas.width = px; cropCanvas.height = px;
}

function drawCropInto(ctx, sizePx){
  var img = state.sourceBitmap, c = state.crop, k = sizePx / S;
  ctx.setTransform(k,0,0,k,0,0);
  ctx.clearRect(0,0,S,S);
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,S,S);
  ctx.save();
  ctx.translate(S/2 + c.tx, S/2 + c.ty);
  ctx.rotate(c.angle);
  ctx.scale(c.scale, c.scale);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -state.base.w/2, -state.base.h/2, state.base.w, state.base.h);
  ctx.restore();
  ctx.setTransform(1,0,0,1,0,0);
}
function renderCrop(){ if(cropCtx && state.sourceBitmap && cropCanvas.width) drawCropInto(cropCtx, cropCanvas.width); }

function exportCrop(OUT){
  var cv = document.createElement('canvas');
  cv.width = OUT; cv.height = OUT;
  drawCropInto(cv.getContext('2d'), OUT);
  return cv;
}

function setupCropper(){
  cropCanvas = $('#cropCanvas');
  if(!cropCanvas) return;
  cropCtx = cropCanvas.getContext('2d');

  var zoom = $('#zoomRange'), rot = $('#rotRange');
  zoom.addEventListener('input', function(){ state.crop.scale = clamp(zoom.value/100, 0.4, 8); renderCrop(); });
  rot.addEventListener('input', function(){ state.crop.angle = rot.value * Math.PI/180; renderCrop(); });
  $('#cropReset').addEventListener('click', function(){ initCrop(); });

  function syncSliders(){
    zoom.value = Math.round(state.crop.scale*100);
    var deg = ((state.crop.angle*180/Math.PI)+180)%360; if(deg>180) deg-=360;
    rot.value = Math.round(deg);
  }

  /* Gestos: 1 dedo pan, 2 dedos pinch-zoom + rotar */
  var pts = {}, gesture = null;
  function toLogical(dx,dy){
    var f = S / (cropRect ? cropRect.width : 1);
    return { x: dx*f, y: dy*f };
  }
  cropCanvas.addEventListener('pointerdown', function(e){
    cropCanvas.setPointerCapture(e.pointerId);
    pts[e.pointerId] = { x:e.clientX, y:e.clientY };
    cropRect = cropCanvas.getBoundingClientRect();
    if(Object.keys(pts).length===2) startPinch(Object.keys(pts));
  });
  cropCanvas.addEventListener('pointermove', function(e){
    if(!pts[e.pointerId]) return;
    var prev = pts[e.pointerId];
    pts[e.pointerId] = { x:e.clientX, y:e.clientY };
    var ids = Object.keys(pts);
    if(ids.length===1){
      var d = toLogical(e.clientX-prev.x, e.clientY-prev.y);
      state.crop.tx += d.x; state.crop.ty += d.y;
      renderCrop();
    } else if(ids.length>=2 && gesture){
      updatePinch(ids);
    }
  });
  function endPointer(e){
    if(pts[e.pointerId]) delete pts[e.pointerId];
    try{ cropCanvas.releasePointerCapture(e.pointerId); }catch(_){}
    gesture = null;
    if(Object.keys(pts).length===2) startPinch(Object.keys(pts));
    syncSliders();
  }
  cropCanvas.addEventListener('pointerup', endPointer);
  cropCanvas.addEventListener('pointercancel', endPointer);

  function startPinch(ids){
    var a=pts[ids[0]], b=pts[ids[1]];
    gesture = {
      dist: Math.hypot(b.x-a.x, b.y-a.y),
      ang: Math.atan2(b.y-a.y, b.x-a.x),
      mid: { x:(a.x+b.x)/2, y:(a.y+b.y)/2 },
      scale0: state.crop.scale,
      angle0: state.crop.angle
    };
  }
  function updatePinch(ids){
    var a=pts[ids[0]], b=pts[ids[1]];
    var dist = Math.hypot(b.x-a.x, b.y-a.y);
    var ang  = Math.atan2(b.y-a.y, b.x-a.x);
    var mid  = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
    state.crop.scale = clamp(gesture.scale0 * (dist/gesture.dist), 0.4, 8);
    state.crop.angle = gesture.angle0 + (ang - gesture.ang);
    var dm = toLogical(mid.x-gesture.mid.x, mid.y-gesture.mid.y);
    state.crop.tx += dm.x; state.crop.ty += dm.y;
    gesture.mid = mid; gesture.dist = dist; gesture.ang = ang;
    gesture.scale0 = state.crop.scale; gesture.angle0 = state.crop.angle;
    syncSliders(); renderCrop();
  }

  cropCanvas.addEventListener('wheel', function(e){
    e.preventDefault();
    state.crop.scale = clamp(state.crop.scale * (e.deltaY<0?1.06:0.94), 0.4, 8);
    zoom.value = Math.round(state.crop.scale*100);
    renderCrop();
  }, { passive:false });

  window.addEventListener('resize', function(){
    if($('#s3').classList.contains('is-active')){ resizeCropCanvas(); renderCrop(); }
  });

  $('#cropConfirm').addEventListener('click', goToArte);
}

/* ======================================================================
   PASO 3 — Elegir portada, con la cara ya aplicada (pantalla s4)
   ====================================================================== */
var PREV_W = 451, PREV_H = 637;   // mitad del sub-compuesto

function cropSignature(){
  var c = state.crop;
  return [c.tx|0, c.ty|0, Math.round(c.scale*1000), Math.round(c.angle*1000)].join('_');
}

/* Compone cada arte con la cara del usuario (misma matemática que el final) */
function renderArtePreviews(){
  var sig = cropSignature();
  if(state.previews && state.previewSig === sig) return;
  var k = PREV_W / SUB_W;
  var cropCv = exportCrop(560);
  var out = [];
  for(var i=0;i<6;i++){
    var f = faceFor(i);
    var cv = document.createElement('canvas');
    cv.width = PREV_W; cv.height = PREV_H;
    var c = cv.getContext('2d');
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(cropCv, (f.cx-f.half)*k, (f.cy-f.half)*k, f.half*2*k, f.half*2*k);
    c.drawImage(state.arteImgs[i], 0, 0, PREV_W, PREV_H);
    out.push(cv.toDataURL('image/webp', 0.86));
  }
  state.previews = out;
  state.previewSig = sig;
}

function goToArte(){
  busy(true,'Armando portadas…');
  afterPaint(function(){
    try{ renderArtePreviews(); }catch(_){ state.previews = null; }
    paintCarousel();
    busy(false);
    show('s4');
  });
}

var carPaint = function(){};
function paintCarousel(){ carPaint(); }

function setupCarousel(){
  var mainImg = $('#carMain'), leftImg = $('#carLeft'), rightImg = $('#carRight');
  var n = ARTE_SRC.length;

  function srcFor(i){
    return (state.previews && state.previews[i]) ? state.previews[i] : ARTE_SRC[i];
  }
  carPaint = function(){
    var i = state.arteIndex;
    mainImg.src  = srcFor(i);
    leftImg.src  = srcFor((i-1+n)%n);
    rightImg.src = srcFor((i+1)%n);
  };
  function go(d){ state.arteIndex = (state.arteIndex + d + n) % n; carPaint(); }

  $('#carPrev').addEventListener('click', function(){ go(-1); });
  $('#carNext').addEventListener('click', function(){ go(1); });

  // swipe táctil
  var stage = $('#carStage'), sx=0, active=false;
  stage.addEventListener('pointerdown', function(e){ active=true; sx=e.clientX; });
  stage.addEventListener('pointerup', function(e){
    if(!active) return; active=false;
    var dx=e.clientX-sx;
    if(Math.abs(dx)>40) go(dx<0?1:-1);
  });
  document.addEventListener('keydown', function(e){
    if(!$('#s4').classList.contains('is-active')) return;
    if(e.key==='ArrowLeft') go(-1);
    if(e.key==='ArrowRight') go(1);
  });

  carPaint();
  $('#arteConfirm').addEventListener('click', goToResult);
}

/* ======================================================================
   Composición final 1080x1920
   ====================================================================== */
function composeFinal(){
  var idx = state.arteIndex;
  var f = faceFor(idx);

  // sub-compuesto 902x1275: cara (abajo) -> arte (encima, recorta con su alfa)
  var sub = document.createElement('canvas');
  sub.width = SUB_W; sub.height = SUB_H;
  var sctx = sub.getContext('2d');
  var cropCv = exportCrop(560);
  sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(cropCv, f.cx - f.half, f.cy - f.half, f.half*2, f.half*2);
  sctx.drawImage(state.arteImgs[idx], 0, 0, SUB_W, SUB_H);

  var cv = document.createElement('canvas');
  cv.width = FINAL_W; cv.height = FINAL_H;
  var ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sub, OX, OY);
  ctx.drawImage(state.plantillaImg, 0, 0, FINAL_W, FINAL_H);
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(state.texturaImg, 0, 0, FINAL_W, FINAL_H);
  ctx.globalCompositeOperation = 'source-over';
  return cv;
}

function goToResult(){
  busy(true,'Armando portada…');
  afterPaint(function(){
    var cv = composeFinal();
    var host = $('#resultFrame');
    host.innerHTML='';
    host.appendChild(cv);
    cv.toBlob(function(blob){
      state.finalBlob = blob;
      busy(false);
      show('s5');
    }, 'image/png');
  });
}

/* ======================================================================
   Pantalla final — Compartir (celular) / Descargar (escritorio)
   ====================================================================== */
var FILE_NAME = 'mi-portada-hayley-williams.png';

function downloadBlob(blob){
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = FILE_NAME;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
}

/* ¿Es un dispositivo móvil? Se decide por DISPOSITIVO, no por capacidad:
   Safari de macOS también soporta el menú nativo, y en escritorio siempre
   queremos descarga directa, sea el sistema operativo que sea.            */
function isMobileDevice(){
  var uad = navigator.userAgentData;
  if(uad && typeof uad.mobile === 'boolean') return uad.mobile;
  var ua = navigator.userAgent || '';
  if(/Android|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|webOS/i.test(ua)) return true;
  // iPadOS se presenta como "Macintosh": se lo reconoce por el táctil real
  if(/Macintosh|Mac OS X/.test(ua) && (navigator.maxTouchPoints||0) > 1) return true;
  var coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  return !!coarse && (navigator.maxTouchPoints||0) > 0;
}

/* ¿El navegador puede compartir archivos por el menú nativo? */
function canShareFiles(){
  try{
    return !!(navigator.canShare && navigator.share &&
              navigator.canShare({ files:[new File([new Blob()],'x.png',{type:'image/png'})] }));
  }catch(_){ return false; }
}

function setupResult(){
  var share = $('#btnShare');
  // El botón dice COMPARTIR siempre; lo que cambia es a dónde va:
  // A) celular con menú nativo  ·  B) escritorio (cualquier SO): descarga directa
  var useShare = isMobileDevice() && canShareFiles();

  share.addEventListener('click', function(){
    var blob = state.finalBlob; if(!blob) return;

    if(!useShare){ downloadBlob(blob); return; }        // B) escritorio

    var file = new File([blob], FILE_NAME, { type:'image/png' });
    navigator.share({                                   // A) celular
      files:[file],
      title:'The Hayley Williams Show',
      text:'¡Creá tu portada del tour!'
    }).catch(function(){
      downloadBlob(blob);   // si cancela o falla, se descarga igual
    });
  });

  $('#btnRestart').addEventListener('click', function(){ show('s1'); });
}

/* ======================================================================
   Arranque
   ====================================================================== */
function bindNav(){
  $$('[data-go]').forEach(function(btn){
    btn.addEventListener('click', function(){ show('s'+btn.getAttribute('data-go')); });
  });
  $$('[data-back]').forEach(function(btn){
    btn.addEventListener('click', function(){ show('s'+btn.getAttribute('data-back')); });
  });
}

function preload(){
  busy(true,'Cargando…');
  var jobs = ARTE_SRC.map(loadImage)
    .concat([ loadImage(ASSETS.plantilla), loadImage(ASSETS.textura) ]);
  return Promise.all(jobs).then(function(imgs){
    state.arteImgs = imgs.slice(0,6);
    state.plantillaImg = imgs[6];
    state.texturaImg = imgs[7];
    busy(false);
  });
}

function init(){
  busyEl = $('#busy');
  bindNav();
  setupUpload();
  setupCropper();
  setupCarousel();
  setupResult();
  show('s1');
  preload().catch(function(){
    busy(true,'Error al cargar los recursos');
    setTimeout(function(){ busy(false); }, 2500);
  });
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
