const picker = document.querySelector('#fontPicker');
const fontName = document.querySelector('#fontName');
const applyButton = document.querySelector('#apply');
const restoreButton = document.querySelector('#restore');
const gameStatus = document.querySelector('#gameStatus');
const progress = document.querySelector('#progress');
const previewBoxes = [...document.querySelectorAll('.preview-box')];
const dropZone = document.querySelector('#dropZone');
const variableSection = document.querySelector('#variableSection');
const axisControls = document.querySelector('#axisControls');
const resetAxesButton = document.querySelector('#resetAxes');
const weightControl = document.querySelector('#weightControl');
const weightSlider = document.querySelector('#fontWeightSlider');
const weightValue = document.querySelector('#fontWeightValue');

let selectedFont = null;
let previewFace = null;
let applyAvailable = false;
let isBusy = false;
let gameRunning = false;
let selectedAxisValues = {};
let selectedAxes = [];

const AXIS_NAMES = { wdth: '字宽 Width', slnt: '倾斜 Slant', ital: '斜体 Italic', opsz: '光学尺寸 Optical Size' };

function setMessage(message, kind = '') {
  progress.className = `progress ${kind}`.trim();
  progress.textContent = message;
}

function setBusy(busy) {
  isBusy = busy;
  picker.disabled = busy;
  restoreButton.disabled = busy;
  gameStatus.disabled = busy;
  weightSlider.disabled = busy;
  applyButton.disabled = busy || !selectedFont || !applyAvailable || gameRunning;
  applyButton.textContent = busy ? '生成中…' : '应用';
}

async function refreshStatus({ keepMessage = true } = {}) {
  try {
    const status = await window.palFont.getStatus();
    applyAvailable = status.applyAvailable;
    gameRunning = status.gameRunning;
    gameStatus.textContent = status.gameFound ? '🟢 已检测到游戏！' : '🔴 未检测到游戏（点击选择游戏路径）';
    gameStatus.className = `game-status ${status.gameFound ? 'running' : 'stopped'}`;
    gameStatus.title = status.gameFound ? `${status.gamePath}\n点击可更改游戏路径` : '点击选择 Palworld 游戏安装文件夹';
    applyButton.disabled = isBusy || !selectedFont || !applyAvailable || gameRunning || !status.gameFound;
    if (!status.gameFound) {
      setMessage('未检测到 Palworld，请点击上方状态选择游戏路径。');
    } else if (!status.offlineReady) {
      setMessage('程序组件不完整，请重新下载本工具。');
    } else if (gameRunning && !keepMessage) {
      setMessage('请先退出 Palworld，再应用或还原字体。');
    }
  } catch {
    gameStatus.textContent = '🔴 无法检测游戏（点击选择路径）';
    gameStatus.className = 'game-status stopped';
    setMessage('无法检测游戏状态。');
  }
}

function updateSliderFill(slider) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const value = Number(slider.value);
  const percentage = max === min ? 0 : ((value - min) / (max - min)) * 100;
  slider.style.setProperty('--slider-fill', `${percentage}%`);
}

function updateVariablePreview() {
  const settings = Object.entries(selectedAxisValues).map(([tag, value]) => `"${tag}" ${value}`).join(', ');
  previewBoxes.forEach(box => {
    box.style.fontVariationSettings = settings || 'normal';
    box.style.fontWeight = selectedAxisValues.wght ?? '400';
  });
}

function renderVariableAxes(axes = []) {
  selectedAxes = axes;
  selectedAxisValues = {};
  axisControls.replaceChildren();
  const weightAxis = axes.find(axis => axis.tag === 'wght');
  weightControl.hidden = !weightAxis;
  if (weightAxis) {
    weightSlider.min = weightAxis.min;
    weightSlider.max = weightAxis.max;
    weightSlider.step = Number.isInteger(weightAxis.min) && Number.isInteger(weightAxis.max) ? 1 : 0.1;
    weightSlider.value = weightAxis.default;
    weightSlider.dataset.default = weightAxis.default;
    weightValue.textContent = weightAxis.default;
    selectedAxisValues.wght = weightAxis.default;
    updateSliderFill(weightSlider);
  }
  const otherAxes = axes.filter(axis => axis.tag !== 'wght');
  variableSection.hidden = otherAxes.length === 0;
  for (const axis of otherAxes) {
    selectedAxisValues[axis.tag] = axis.default;
    const control = document.createElement('div');
    control.className = 'axis-control';
    const label = document.createElement('div');
    label.className = 'axis-label';
    const name = document.createElement('span');
    name.textContent = AXIS_NAMES[axis.tag] || `${axis.name} (${axis.tag})`;
    const value = document.createElement('span');
    value.textContent = axis.default;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = axis.min;
    input.max = axis.max;
    input.step = Number.isInteger(axis.min) && Number.isInteger(axis.max) ? 1 : 0.1;
    input.value = axis.default;
    input.dataset.tag = axis.tag;
    input.dataset.default = axis.default;
    input.addEventListener('input', () => {
      selectedAxisValues[axis.tag] = Number(input.value);
      value.textContent = input.value;
      updateVariablePreview();
      setMessage(gameRunning ? '参数已调整，请退出 Palworld 后重新应用。' : '参数已调整，点击应用即可生效。');
    });
    label.append(name, value);
    control.append(label, input);
    axisControls.append(control);
  }
  updateVariablePreview();
}

weightSlider.addEventListener('input', () => {
  selectedAxisValues.wght = Number(weightSlider.value);
  weightValue.textContent = weightSlider.value;
  updateSliderFill(weightSlider);
  updateVariablePreview();
  setMessage(gameRunning ? '字重已调整，请退出 Palworld 后重新应用。' : `字重已调整为 ${weightSlider.value}，点击应用即可生效。`);
});

resetAxesButton.addEventListener('click', () => {
  const weightAxis = selectedAxes.find(axis => axis.tag === 'wght');
  if (weightAxis) {
    weightSlider.value = weightAxis.default;
    weightValue.textContent = weightAxis.default;
    selectedAxisValues.wght = weightAxis.default;
    updateSliderFill(weightSlider);
  }
  for (const input of axisControls.querySelectorAll('input[type="range"]')) {
    input.value = input.dataset.default;
    selectedAxisValues[input.dataset.tag] = Number(input.value);
    input.previousElementSibling.lastElementChild.textContent = input.value;
  }
  updateVariablePreview();
  setMessage(gameRunning ? '参数已恢复默认，请退出 Palworld 后重新应用。' : '参数已恢复默认，点击应用即可生效。');
});

gameStatus.addEventListener('click', async () => {
  if (isBusy) return;
  try {
    const result = await window.palFont.selectGamePath();
    if (!result.canceled) setMessage('游戏路径设置成功。', 'success');
    await refreshStatus();
  } catch (error) {
    const message = String(error?.message || '');
    setMessage(message.includes('未找到 Palworld') ? '所选文件夹中未找到 Palworld。' : '游戏路径设置失败。');
  }
});

picker.addEventListener('click', async () => {
  try { await window.palFont.openFontLibrary(); }
  catch { setMessage('无法打开字体列表。'); }
});

async function useFont(result) {
  if (!result) return;
  if (previewFace) document.fonts.delete(previewFace);
  const weightAxis = result.axes?.find(axis => axis.tag === 'wght');
  const descriptors = weightAxis ? { weight: `${weightAxis.min} ${weightAxis.max}` } : {};
  previewFace = new FontFace('PalFontPreview', `url(${result.dataUrl})`, descriptors);
  await previewFace.load();
  document.fonts.add(previewFace);
  previewBoxes.forEach(box => { box.style.fontFamily = 'PalFontPreview'; });
  selectedFont = result;
  fontName.textContent = result.name;
  renderVariableAxes(result.axes);
  applyButton.disabled = !applyAvailable || gameRunning;
  setMessage(result.variable ? '已载入 Variable Font，可调整参数后应用。' : '字体已载入，点击应用即可生效。');
}

window.palFont.onFontSelected(result => {
  useFont(result).catch(() => setMessage('字体无法加载。'));
});

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
}
dropZone.addEventListener('drop', async event => {
  try {
    const libraryFontPath = event.dataTransfer.getData('application/x-palfont-path');
    const file = event.dataTransfer.files[0];
    const fontPath = libraryFontPath || (file ? window.palFont.getDroppedFilePath(file) : '');
    if (!fontPath) return;
    await useFont(await window.palFont.loadFont(fontPath));
  } catch {
    setMessage('拖入的字体无法使用。');
  }
});

applyButton.addEventListener('click', async () => {
  if (isBusy || !selectedFont) return;
  setBusy(true);
  setMessage('正在导入字体…');
  try {
    await window.palFont.applyFont(selectedFont.path, selectedAxisValues);
    setMessage('应用成功。', 'success');
  } catch (error) {
    const message = String(error?.message || '');
    setMessage(message.includes('请先退出 Palworld') ? '请先退出 Palworld，再重新应用。' : '安装失败。');
  } finally {
    setBusy(false);
    await refreshStatus();
  }
});

restoreButton.addEventListener('click', async () => {
  if (isBusy) return;
  setBusy(true);
  setMessage('正在还原默认字体…');
  try {
    await window.palFont.restoreDefault();
    setMessage('还原成功。', 'success');
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('请先退出 Palworld')) setMessage('请先退出 Palworld，再还原默认字体。');
    else if (message.includes('未找到 Palworld')) setMessage('未检测到 Palworld，请先选择游戏路径。');
    else setMessage('还原失败。');
  } finally {
    setBusy(false);
    await refreshStatus();
  }
});

window.palFont.onProgress(message => { setMessage(message); });
refreshStatus({ keepMessage: false });
setInterval(() => refreshStatus(), 3000);
