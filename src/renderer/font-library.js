const list = document.querySelector('#fontList');
const status = document.querySelector('#status');
const search = document.querySelector('#search');
let fonts = [];

function render() {
  const query = search.value.trim().toLocaleLowerCase('zh-CN');
  const visible = query ? fonts.filter(font => `${font.name} ${font.path}`.toLocaleLowerCase('zh-CN').includes(query)) : fonts;
  list.replaceChildren(...visible.map(font => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'font-item'; button.title = '双击使用，或拖到主窗口'; button.draggable = true;
    const name = document.createElement('div'); name.className = 'font-name'; name.textContent = font.name; name.style.fontFamily = `"${font.name.replaceAll('"', '')}"`;
    const file = document.createElement('div'); file.className = 'font-file'; file.textContent = font.path;
    button.append(name, file);
    button.addEventListener('dblclick', async () => {
      try { button.disabled = true; status.textContent = `正在载入 ${font.name}…`; await window.palFont.selectSystemFont(font.path); }
      catch { button.disabled = false; status.textContent = '该字体无法使用。'; }
    });
    button.addEventListener('dragstart', event => {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-palfont-path', font.path);
      event.dataTransfer.setData('text/plain', font.path);
    });
    return button;
  }));
  status.textContent = `显示 ${visible.length} / ${fonts.length} 个字体`;
}

search.addEventListener('input', render);
window.palFont.listSystemFonts().then(result => { fonts = result; render(); }).catch(() => { status.textContent = '字体列表读取失败。'; });
