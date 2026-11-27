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

for (const [button,input] of [["camera","capture"],["gallery","upload"]]) {
  const picker = byId(input);
  byId(button).onclick = () => picker.click();
  picker.onchange = async () => {
    const file = picker.files[0];
    if (!file) return;
    picker.value = "";
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
  };
}

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
