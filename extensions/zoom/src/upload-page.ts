/** Returns a self-contained HTML page for the file-upload UI. */
export function getUploadPageHtml(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Upload File</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;color:#333;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}
.card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:480px;width:100%;padding:32px}
h1{font-size:1.25rem;margin-bottom:8px}
.sub{color:#666;font-size:.875rem;margin-bottom:24px}
.drop{border:2px dashed #ccc;border-radius:8px;padding:48px 16px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s}
.drop.over{border-color:#2d8cf0;background:#eef6ff}
.drop p{margin-bottom:12px;color:#888}
.btn{display:inline-block;padding:10px 20px;background:#2d8cf0;color:#fff;border:none;border-radius:6px;font-size:.875rem;cursor:pointer}
.btn:hover{background:#1a6fd4}
.btn:disabled{opacity:.5;cursor:not-allowed}
input[type=file]{display:none}
.status{margin-top:16px;font-size:.875rem;text-align:center}
.status.ok{color:#2ea44f}
.status.err{color:#d32f2f}
.info{font-size:.75rem;color:#999;margin-top:8px;text-align:center}
</style>
</head>
<body>
<div class="card">
<h1>Upload a File</h1>
<p class="sub">Drag &amp; drop, paste (Ctrl+V), or pick a file.</p>
<div class="drop" id="drop">
<p>Drop file here</p>
<button class="btn" id="pick">Choose File</button>
<input type="file" id="fileInput" accept="image/*,.pdf,.txt,.csv,.json,.xml,.html,.md,.log,.doc,.docx,.xls,.xlsx,.ppt,.pptx"/>
</div>
<div class="status" id="status"></div>
<div class="info">Max 10 MB. Images, PDFs, text, and common document formats.</div>
</div>
<script>
(function(){
var TOKEN=${JSON.stringify(token)};
var MAX=10*1024*1024;
var drop=document.getElementById("drop");
var fileInput=document.getElementById("fileInput");
var pick=document.getElementById("pick");
var statusEl=document.getElementById("status");
var busy=false;

pick.addEventListener("click",function(){fileInput.click()});
fileInput.addEventListener("change",function(){if(fileInput.files[0])handleFile(fileInput.files[0])});

drop.addEventListener("dragover",function(e){e.preventDefault();drop.classList.add("over")});
drop.addEventListener("dragleave",function(){drop.classList.remove("over")});
drop.addEventListener("drop",function(e){e.preventDefault();drop.classList.remove("over");if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0])});

document.addEventListener("paste",function(e){
  var items=e.clipboardData&&e.clipboardData.items;
  if(!items)return;
  for(var i=0;i<items.length;i++){
    if(items[i].kind==="file"){handleFile(items[i].getAsFile());return}
  }
});

function handleFile(file){
  if(busy)return;
  if(file.size>MAX){show("File too large (max 10 MB).","err");return}
  busy=true;
  show("Uploading "+file.name+"...","");
  var reader=new FileReader();
  reader.onload=function(){
    var data=reader.result;
    fetch(location.pathname+location.search,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:TOKEN,filename:file.name,mimeType:file.type,size:file.size,data:data})
    }).then(function(r){return r.json()}).then(function(j){
      if(j.ok){show("File uploaded successfully!","ok")}
      else{show(j.error||"Upload failed.","err");busy=false}
    }).catch(function(err){show("Upload failed: "+err.message,"err");busy=false});
  };
  reader.onerror=function(){show("Failed to read file.","err");busy=false};
  reader.readAsDataURL(file);
}

function show(msg,cls){statusEl.textContent=msg;statusEl.className="status"+(cls?" "+cls:"")}
})();
</script>
</body>
</html>`;
}

/** Returns a simple error page. */
export function getUploadErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Upload Error</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:400px;padding:32px;text-align:center}
h1{color:#d32f2f;font-size:1.25rem;margin-bottom:8px}
p{color:#666;font-size:.875rem}
</style>
</head>
<body>
<div class="card">
<h1>Upload Unavailable</h1>
<p>${message.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c)}</p>
</div>
</body>
</html>`;
}
