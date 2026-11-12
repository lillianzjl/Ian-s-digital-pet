let pin = "";
try { pin = sessionStorage.getItem("ginger-pin") || ""; } catch {}

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...(options.headers || {}), "x-parent-pin": pin } });
  if (res.status === 401) {
    pin = prompt("请输入家长 PIN") || "";
    try { sessionStorage.setItem("ginger-pin", pin); } catch {}
    return api(path, options);
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res;
}
const json = (path, method, body) =>
  api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

async function thumbnail(m) {
  if (!m.type.startsWith("image/")) return el("div", { className: "thumb doc" }, m.type === "application/pdf" ? "PDF" : "TXT");
  const img = el("img", { className: "thumb", alt: m.name });
  api(`/api/parent/files/${encodeURIComponent(m.file)}`)
    .then((r) => r.blob())
    .then((b) => (img.src = URL.createObjectURL(b)))
    .catch(() => {});
  return img;
}

async function render(state) {
  $("topic-input").value = state.topic || "";
  $("notes").value = state.notes || "";
  $("demo-banner").hidden = !state.demo;

  const list = $("materials");
  list.innerHTML = "";
  if (!state.materials.length) list.append(el("p", { className: "hint" }, "还没有材料。"));
  for (const m of [...state.materials].reverse()) {
    const text = el("textarea", { rows: 8, value: m.text || "" });
    const active = el("input", {
      type: "radio",
      name: "active",
      checked: m.id === state.activeMaterialId,
      onchange: async () => render(await json("/api/parent/settings", "POST", { activeMaterialId: m.id })),
    });
    list.append(
      el("div", { className: "material" },
        await thumbnail(m),
        el("div", { className: "material-body" },
          el("div", { className: "material-head" },
            el("strong", {}, m.name),
            el("label", { className: "inline" }, active, " 今天读这个")),
          text,
          el("div", { className: "row" },
            el("button", { className: "small", onclick: async () => {
              await json(`/api/parent/materials/${m.id}`, "PATCH", { text: text.value });
              flash("文字已保存");
            } }, "保存文字"),
            el("button", { className: "small danger", onclick: async () => {
              if (confirm(`删除“${m.name}”？`)) render(await json(`/api/parent/materials/${m.id}`, "DELETE"));
            } }, "删除"))))
    );
  }
  if (state.materials.length && !state.activeMaterialId) {
    list.prepend(el("p", { className: "hint" }, "提示：还没选今天读哪份材料。"));
  }
}

function flash(msg) {
  $("saved").textContent = msg;
  setTimeout(() => ($("saved").textContent = ""), 2500);
}

$("save-settings").addEventListener("click", async () => {
  render(await json("/api/parent/settings", "POST", { topic: $("topic-input").value, notes: $("notes").value }));
  flash("已保存 ✓");
});

// Phone photos can be huge; shrink them before upload so they are quick to send and read.
function shrinkImage(file, maxSide = 1800) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return resolve(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => resolve(new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" })), "image/jpeg", 0.88);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const status = $("upload-status");
  status.textContent = `正在上传并识别 ${files.length} 个文件，请稍等…`;
  const form = new FormData();
  for (const f of files) form.append("files", await shrinkImage(f));
  try {
    const res = await api("/api/parent/upload", { method: "POST", body: form });
    render(await res.json());
    status.textContent = "完成 ✓";
  } catch (err) {
    status.textContent = `上传失败：${err.message}`;
  }
}
$("files").addEventListener("change", (e) => { uploadFiles(e.target.files); e.target.value = ""; });
$("camera").addEventListener("change", (e) => { uploadFiles(e.target.files); e.target.value = ""; });

async function loadLog() {
  const log = await (await api("/api/parent/chatlog")).json();
  const box = $("chatlog");
  box.innerHTML = "";
  if (!log.length) box.append(el("p", { className: "hint" }, "还没有聊天记录。"));
  for (const entry of log) {
    box.append(
      el("div", { className: "log" },
        el("time", {}, new Date(entry.at).toLocaleString()),
        el("div", {}, el("b", {}, "Ian: "), entry.ian),
        el("div", {}, el("b", {}, "Ginger: "), entry.ginger))
    );
  }
}
$("refresh-log").addEventListener("click", loadLog);

render(await (await api("/api/parent/state")).json());
loadLog();
