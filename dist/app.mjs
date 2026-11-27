const byId = id => document.getElementById(id);
const scan = byId("scan"), preview = byId("preview"), status = byId("status");
const confirm = byId("confirm"), smartphone = byId("smartphone");
const estimates = byId("estimates"), phone = byId("phone"), rows = byId("rows");
const worker = new Worker("./worker.mjs",{type:"module"});
let photoUrl, generation = 0;
const catalog = fetch("./metals.json").then(response => {
  if (!response.ok) throw new Error("Metal data unavailable");
  return response.json();
});
catalog.catch(() => {});

async function showPhoto(file) {
  const id = ++generation;
  scan.disabled = true;
  status.textContent = "";
  preview.hidden = true;
  confirm.hidden = estimates.hidden = true;
  smartphone.checked = false;
  phone.value = "";
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = URL.createObjectURL(file);
  preview.src = photoUrl;
  try {
    await preview.decode();
    if (id === generation) {
      preview.hidden = false;
      scan.disabled = false;
    }
  } catch {
    if (id === generation) status.textContent = "This photo could not be opened. Try a JPEG or PNG.";
  }
}

const camera = byId("camera"), upload = byId("upload");
const panel = document.createElement("div");
panel.hidden = true;
panel.innerHTML = `<video playsinline muted style="display:block;width:100%;max-height:22rem;margin:.75rem 0;background:#153e34"></video>
<button type="button" disabled>Capture photo</button>
<button type="button">Close camera</button>`;
preview.before(panel);
const video = panel.querySelector("video");
const [capture, close] = panel.querySelectorAll("button");
let cameraRequest = 0;

function stopCamera() {
  cameraRequest++;
  video.srcObject?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  panel.hidden = true;
  capture.disabled = true;
}

camera.onclick = async () => {
  stopCamera();
  const id = cameraRequest;
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "Camera unavailable here. Open the HTTPS link in your browser or upload a photo.";
    return;
  }
  panel.hidden = false;
  status.textContent = "Opening camera…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {facingMode: {ideal: "environment"}},
      audio: false,
    });
    if (id !== cameraRequest) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    video.srcObject = stream;
    await video.play();
    if (id !== cameraRequest) return;
    capture.disabled = false;
    status.textContent = "";
  } catch (error) {
    if (id !== cameraRequest) return;
    stopCamera();
    status.textContent = error.name === "NotAllowedError"
      ? "Camera permission was denied. Allow camera access in your browser or upload a photo."
      : "Could not open the camera. Check that it is connected and available, or upload a photo.";
  }
};

capture.onclick = () => {
  if (!video.videoWidth || !video.videoHeight) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  stopCamera();
  const id = cameraRequest, photoId = generation;
  canvas.toBlob(photo => {
    if (photo && id === cameraRequest && photoId === generation) showPhoto(photo);
  }, "image/jpeg", 0.92);
};
close.onclick = () => {
  stopCamera();
  status.textContent = "";
};
byId("gallery").onclick = () => {
  if (!panel.hidden) {
    stopCamera();
    status.textContent = "";
  }
  upload.click();
};
upload.onchange = () => {
  const file = upload.files[0];
  upload.value = "";
  if (file) showPhoto(file);
};
window.addEventListener("pagehide", stopCamera);

scan.onclick = () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 224;
  const context = canvas.getContext("2d");
  context.drawImage(preview,0,0,224,224);
  const rgba = context.getImageData(0,0,224,224).data;
  const pixels = new Float32Array(224*224*3);
  for (let i=0,j=0; i<rgba.length; i+=4,j+=3) pixels.set(rgba.subarray(i,i+3),j);
  scan.disabled = true;
  status.textContent = "Identifying device…";
  confirm.hidden = estimates.hidden = true;
  smartphone.checked = false;
  phone.value = "";
  worker.postMessage({id:++generation,pixels},[pixels.buffer]);
};
worker.onerror = () => {
  status.textContent = "Scanner could not start. Reload the page and try again.";
};
worker.onmessage = ({data:{id,category,score,error}}) => {
  if (id !== generation) return;
  scan.disabled = false;
  if (error) {status.textContent = error; return;}
  const percent = new Intl.NumberFormat("en",{style:"percent"}).format(score);
  if (score < .70) {
    status.textContent = `Uncertain result. Closest category: ${category} (${percent}). Try another photo.`;
    return;
  }
  status.textContent = `Detected: ${category} · Model score: ${percent}`;
  if (category === "Mobile") confirm.hidden = false;
  else status.textContent += ". Metal estimates are available for smartphones.";
};

async function showEstimates() {
  const id = generation;
  estimates.hidden = true;
  if (!smartphone.checked) return;
  try {
    const data = await catalog;
    if (id !== generation || !smartphone.checked) return;
    if (phone.options.length === 1) {
      for (const name of Object.keys(data.models)) phone.add(new Option(name,name));
    }
    const values = phone.value ? data.models[phone.value] : data.overall;
    rows.replaceChildren();
    for (const [metal,low,median,high,count] of values) {
      const row = rows.insertRow();
      for (const value of [metal,median,`${low}–${high}`,count]) row.insertCell().textContent = value;
    }
    estimates.hidden = false;
  } catch {
    if (id === generation) status.textContent = "Metal estimates could not load. Reload the page and try again.";
  }
}
smartphone.onchange = phone.onchange = showEstimates;
