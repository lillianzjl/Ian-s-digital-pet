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

let voiceListFilled = false;
function renderVoices(state) {
  if ("cloudVoice" in state) $("voice-card").hidden = !state.cloudVoice;
  if (!state.voices || voiceListFilled) return;
  for (const v of state.voices) $("voice-select").append(el("option", { value: v.id }, v.label));
  voiceListFilled = true;
  $("voice-select").value = state.voice;
}
const preview = new Audio();
$("voice-preview").addEventListener("click", async () => {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Hi Ian! I am Ginger. Let's read a book together!", voice: $("voice-select").value }),
  });
  if (!res.ok) return flash("试听失败，请检查 Azure 设置");
  preview.src = URL.createObjectURL(await res.blob());
  preview.play();
});
$("voice-save").addEventListener("click", async () => {
  await json("/api/parent/settings", "POST", { voice: $("voice-select").value });
  flash("声音已保存 ✓");
});

async function render(state) {
  renderVoices(state);
  $("topic-input").value = state.topic || "";
  $("notes").value = state.notes || "";
  if ("demo" in state) $("demo-banner").hidden = !state.demo;

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

$("selftest").addEventListener("click", async () => {
  const out = $("selftest-result");
  out.textContent = "测试中…";
  try {
    const r = await (await api("/api/parent/selftest", { method: "POST" })).json();
    if (r.demo) out.textContent = "❌ 没有设置 ANTHROPIC_API_KEY，现在是演示模式。请在 Railway 的 Variables 里添加。";
    else if (r.ok) out.textContent = `✅ 连接正常。Ginger 说：“${r.say}”`;
    else if (r.error.startsWith("401")) out.textContent = `❌ 密钥无效（${r.error}）。请在 Claude Console 新建一个以 sk-ant-api 开头的密钥，替换 Railway 里的 ANTHROPIC_API_KEY。`;
    else if (r.error.startsWith("400") && /credit|balance/i.test(r.message)) out.textContent = `❌ 账户余额不足（${r.error}）。请到 Claude Console 的 Billing 充值。`;
    else out.textContent = `❌ 出错了：${r.error} ${r.message}`;
  } catch (err) {
    out.textContent = `❌ 测试失败：${err.message}`;
  }
});

// ---------- Reading recordings ----------
const fmtDuration = (sec) => `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;

function starButtons(r, onPick) {
  const wrap = el("div", { className: "stars" });
  for (let n = 1; n <= 5; n++) {
    wrap.append(el("button", { className: `star ${r.stars >= n ? "on" : ""}`, title: `${n} 颗星`, onclick: () => onPick(n) }, r.stars >= n ? "★" : "☆"));
  }
  return wrap;
}

async function loadReadings() {
  const list = await (await api("/api/parent/readings")).json();
  const box = $("readings");
  box.innerHTML = "";
  if (!list.length) box.append(el("p", { className: "hint" }, "还没有录音。"));
  for (const r of list) {
    const player = el("div", { className: "player" });
    const comment = el("textarea", { rows: 2, value: r.comment || "", placeholder: "给 Ian 的评语（可选）" });
    let stars = r.stars;
    const starsBox = el("div");
    const drawStars = () => {
      starsBox.innerHTML = "";
      starsBox.append(starButtons({ stars }, (n) => { stars = n; drawStars(); }));
    };
    drawStars();
    box.append(
      el("div", { className: "reading-item" },
        el("div", { className: "reading-head" },
          el("strong", {}, new Date(r.at).toLocaleString()),
          el("span", { className: "hint" }, `${fmtDuration(r.seconds)}${r.topic ? " · " + r.topic : ""} · ${r.stars ? "已评分" : "未评分"}`)),
        player,
        el("button", { className: "small", onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = "加载中…";
          const blob = await (await api(`/api/parent/readings/${r.id}/audio`)).blob();
          const audio = el("audio", { controls: true, src: URL.createObjectURL(blob) });
          player.replaceChildren(audio);
          e.target.remove();
          audio.play().catch(() => {});
        } }, "▶ 播放"),
        starsBox,
        comment,
        el("div", { className: "row" },
          el("button", { className: "small", onclick: async () => {
            if (!stars) return alert("先点星星打分");
            await json(`/api/parent/readings/${r.id}`, "PATCH", { stars, comment: comment.value });
            flash("评分已保存 ✓");
            loadReadings();
          } }, "保存评分"),
          el("button", { className: "small danger", onclick: async () => {
            if (!confirm("删除这条录音？")) return;
            await api(`/api/parent/readings/${r.id}`, { method: "DELETE" });
            loadReadings();
          } }, "删除")))
    );
  }
}
$("refresh-readings").addEventListener("click", loadReadings);

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
loadReadings();
