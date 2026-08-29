const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CONFIG = {
  pakName: 'zzz_PalFontCustomizer_P.pak'
};
let mainWindow;
let fontLibraryWindow;
let installInProgress = false;
let cachedGameRoot = null;

function getWindowIcon() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.ico');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 540,
    height: 730,
    minWidth: 520,
    minHeight: 700,
    backgroundColor: '#fdfbff',
    icon: getWindowIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
}

function createFontLibraryWindow() {
  if (fontLibraryWindow && !fontLibraryWindow.isDestroyed()) {
    fontLibraryWindow.focus();
    return;
  }
  fontLibraryWindow = new BrowserWindow({
    width: 760, height: 680, minWidth: 620, minHeight: 520,
    parent: mainWindow, backgroundColor: '#fdfbff', icon: getWindowIcon(), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  fontLibraryWindow.loadFile(path.join(__dirname, 'renderer', 'font-library.html'));
  fontLibraryWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  fontLibraryWindow.webContents.on('will-navigate', event => event.preventDefault());
  fontLibraryWindow.on('closed', () => { fontLibraryWindow = null; });
}

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.details = `${stdout}\n${stderr}`.trim();
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function fileExists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return hash.digest('hex');
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function isPalworldRoot(candidate) {
  if (!candidate) return false;
  return fileExists(path.join(candidate, 'Pal', 'Binaries', 'Win64', 'Palworld-Win64-Shipping.exe'));
}

async function normalizeGameRoot(selectedPath) {
  const candidates = [
    selectedPath,
    path.join(selectedPath, 'Palworld'),
    path.join(selectedPath, 'common', 'Palworld'),
    path.join(selectedPath, 'steamapps', 'common', 'Palworld')
  ];
  for (const candidate of candidates) {
    if (await isPalworldRoot(candidate)) return path.resolve(candidate);
  }
  return null;
}

async function registryValue(key, valueName) {
  try {
    const { stdout } = await run('reg.exe', ['query', key, '/v', valueName], { encoding: 'buffer' });
    const decoded = new TextDecoder('gb18030').decode(stdout);
    const line = decoded.split(/\r?\n/).find(item => item.trimStart().startsWith(valueName));
    const match = line?.match(/\s+REG_\w+\s+(.+?)\s*$/i);
    return match?.[1]?.trim() || null;
  } catch { return null; }
}

async function steamRoots() {
  const roots = new Set();
  for (const [key, value] of [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath']
  ]) {
    const found = await registryValue(key, value);
    if (found) roots.add(path.resolve(found.replaceAll('/', '\\')));
  }
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  if (programFilesX86) roots.add(path.join(programFilesX86, 'Steam'));
  const libraries = new Set(roots);
  for (const root of roots) {
    try {
      const vdf = await fs.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
        libraries.add(path.resolve(match[1].replaceAll('\\\\', '\\')));
      }
    } catch { }
  }
  return [...libraries];
}

async function detectGameRoot() {
  try {
    const saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    const normalized = await normalizeGameRoot(saved.gameRoot);
    if (normalized) return normalized;
  } catch { }
  for (const steamRoot of await steamRoots()) {
    const normalized = await normalizeGameRoot(path.join(steamRoot, 'steamapps', 'common', 'Palworld'));
    if (normalized) return normalized;
  }
  return null;
}

async function gameRoot() {
  if (await isPalworldRoot(cachedGameRoot)) return cachedGameRoot;
  cachedGameRoot = await detectGameRoot();
  return cachedGameRoot;
}

async function selectGameRoot() {
  const current = await gameRoot();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Palworld 游戏安装文件夹',
    defaultPath: current || undefined,
    properties: ['openDirectory']
  });
  if (result.canceled) return { canceled: true, gameFound: Boolean(current), gamePath: current };
  const selected = await normalizeGameRoot(result.filePaths[0]);
  if (!selected) throw new Error('所选文件夹中未找到 Palworld。');
  cachedGameRoot = selected;
  await fs.writeFile(settingsPath(), JSON.stringify({ gameRoot: selected }, null, 2), 'utf8');
  return { canceled: false, gameFound: true, gamePath: selected };
}

function resourcePath(...parts) {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(__dirname, '..', 'resources');
  return path.join(root, ...parts);
}

function findSfntTable(data, wantedTag) {
  const tableCount = data.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    if (data.toString('ascii', record, record + 4) !== wantedTag) continue;
    const offset = data.readUInt32BE(record + 8);
    const length = data.readUInt32BE(record + 12);
    if (offset + length > data.length) throw new Error('字体表超出文件范围。');
    return { offset, length };
  }
  return null;
}

function cmapReaders(data) {
  const cmap = findSfntTable(data, 'cmap');
  if (!cmap || cmap.length < 4) return [];
  const count = data.readUInt16BE(cmap.offset + 2);
  const readers = [];
  for (let index = 0; index < count; index += 1) {
    const record = cmap.offset + 4 + index * 8;
    if (record + 8 > cmap.offset + cmap.length) break;
    const offset = cmap.offset + data.readUInt32BE(record + 4);
    if (offset + 2 > data.length) continue;
    const format = data.readUInt16BE(offset);
    if (format === 12 && offset + 16 <= data.length) {
      const groups = data.readUInt32BE(offset + 12);
      readers.push(codePoint => {
        let low = 0, high = groups - 1;
        while (low <= high) {
          const middle = (low + high) >> 1;
          const group = offset + 16 + middle * 12;
          if (group + 12 > data.length) return false;
          const start = data.readUInt32BE(group), end = data.readUInt32BE(group + 4);
          if (codePoint < start) high = middle - 1;
          else if (codePoint > end) low = middle + 1;
          else return (data.readUInt32BE(group + 8) + codePoint - start) !== 0;
        }
        return false;
      });
    } else if (format === 4 && offset + 16 <= data.length) {
      const segCount = data.readUInt16BE(offset + 6) / 2;
      const endCodes = offset + 14;
      const startCodes = endCodes + segCount * 2 + 2;
      const deltas = startCodes + segCount * 2;
      const rangeOffsets = deltas + segCount * 2;
      readers.push(codePoint => {
        if (codePoint > 0xffff) return false;
        for (let segment = 0; segment < segCount; segment += 1) {
          const end = data.readUInt16BE(endCodes + segment * 2);
          if (codePoint > end) continue;
          const start = data.readUInt16BE(startCodes + segment * 2);
          if (codePoint < start) return false;
          const delta = data.readInt16BE(deltas + segment * 2);
          const rangeOffsetPosition = rangeOffsets + segment * 2;
          const rangeOffset = data.readUInt16BE(rangeOffsetPosition);
          if (rangeOffset === 0) return ((codePoint + delta) & 0xffff) !== 0;
          const glyphPosition = rangeOffsetPosition + rangeOffset + (codePoint - start) * 2;
          if (glyphPosition + 2 > data.length) return false;
          const glyph = data.readUInt16BE(glyphPosition);
          return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
        }
        return false;
      });
    }
  }
  return readers;
}

function simplifiedChineseCharacters() {
  const decoder = new TextDecoder('gb18030');
  const characters = new Set();
  for (let lead = 0xb0; lead <= 0xf7; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      const character = decoder.decode(Uint8Array.from([lead, trail]));
      const codePoint = character.codePointAt(0);
      if (codePoint >= 0x4e00 && codePoint <= 0x9fff) characters.add(codePoint);
    }
  }
  return [...characters];
}

const GB2312_HAN = simplifiedChineseCharacters();

async function inspectFont(fontPath) {
  if (!path.isAbsolute(fontPath) || !['.ttf', '.otf'].includes(path.extname(fontPath).toLowerCase())) {
    throw new Error('仅支持 .ttf 和 .otf 字体。');
  }
  const stats = await fs.stat(fontPath);
  if (!stats.isFile() || stats.size > 128 * 1024 * 1024) throw new Error('字体文件无效或体积过大。');
  const data = await fs.readFile(fontPath);
  if (data.length < 12) throw new Error('字体文件过小或已损坏。');
  const signature = data.toString('ascii', 0, 4);
  if (signature === 'ttcf') throw new Error('暂不支持 TTC 字体集合。');
  const tableCount = data.readUInt16BE(4);
  if (12 + tableCount * 16 > data.length) throw new Error('字体表目录无效。');
  const tables = new Set();
  for (let index = 0; index < tableCount; index += 1) {
    tables.add(data.toString('ascii', 12 + index * 16, 16 + index * 16));
  }
  if (!tables.has('cmap') || (!tables.has('glyf') && !tables.has('CFF ') && !tables.has('CFF2'))) {
    throw new Error('这不是受支持的 TrueType/OpenType 字体。');
  }
  const readers = cmapReaders(data);
  const hasGlyph = codePoint => readers.some(reader => reader(codePoint));
  const asciiComplete = Array.from({ length: 95 }, (_, index) => 0x20 + index).every(hasGlyph);
  const chineseCount = GB2312_HAN.reduce((count, codePoint) => count + (hasGlyph(codePoint) ? 1 : 0), 0);
  const chineseCoverage = chineseCount / GB2312_HAN.length;
  const requiredText = '幻兽帕鲁字体替换测试检测到游戏正在运行安装使用建议删除默认中文英文符号';
  const requiredComplete = [...new Set([...requiredText])].every(character => hasGlyph(character.codePointAt(0)));
  if (!asciiComplete || !requiredComplete || chineseCoverage < 0.9) {
    throw new Error(`该字体缺少完整的简体中文字库（覆盖率 ${Math.round(chineseCoverage * 100)}%）。`);
  }
  let variableInfo = { variable: false, axes: [] };
  if (tables.has('fvar')) {
    const helper = resourcePath('bin', 'palfont-font-helper.exe');
    const { stdout } = await run(helper, ['inspect', fontPath]);
    variableInfo = JSON.parse(stdout);
  }
  return { data, ...variableInfo };
}

async function loadFont(fontPath) {
  const inspected = await inspectFont(fontPath);
  return {
    path: fontPath,
    name: path.basename(fontPath),
    dataUrl: `data:font/ttf;base64,${inspected.data.toString('base64')}`,
    variable: inspected.variable,
    axes: inspected.axes
  };
}

async function queryFontRegistry(key) {
  try {
    const { stdout } = await run('reg.exe', ['query', key], { encoding: 'buffer' });
    const decoded = new TextDecoder('gb18030').decode(stdout);
    return decoded.split(/\r?\n/).flatMap(line => {
      const match = line.match(/^\s+(.+?)\s+REG_\w+\s+(.+?)\s*$/);
      if (!match) return [];
      return [{ displayName: match[1].replace(/\s*\((TrueType|OpenType)\)\s*$/i, ''), value: match[2] }];
    });
  } catch { return []; }
}

async function listSystemFonts() {
  const windowsFonts = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const userFonts = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts');
  const entries = [
    ...await queryFontRegistry('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'),
    ...await queryFontRegistry('HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts')
  ];
  const results = new Map();
  for (const entry of entries) {
    const candidates = path.isAbsolute(entry.value) ? [entry.value] : [path.join(windowsFonts, entry.value), path.join(userFonts, entry.value)];
    const fontPath = candidates.find(candidate => require('node:fs').existsSync(candidate));
    if (!fontPath || !['.ttf', '.otf'].includes(path.extname(fontPath).toLowerCase())) continue;
    results.set(fontPath.toLowerCase(), { name: entry.displayName, path: fontPath });
  }
  for (const directory of [windowsFonts, userFonts]) {
    try {
      for (const file of await fs.readdir(directory)) {
        if (!['.ttf', '.otf'].includes(path.extname(file).toLowerCase())) continue;
        const fontPath = path.join(directory, file);
        if (!results.has(fontPath.toLowerCase())) results.set(fontPath.toLowerCase(), { name: path.parse(file).name, path: fontPath });
      }
    } catch { }
  }
  return [...results.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

async function isGameRunning() {
  const { stdout } = await run('tasklist.exe', ['/FI', 'IMAGENAME eq Palworld-Win64-Shipping.exe', '/FO', 'CSV', '/NH']);
  return stdout.toLowerCase().includes('palworld-win64-shipping.exe');
}

async function getStatus() {
  const resolvedGameRoot = await gameRoot();
  const offlineFiles = [
    resourcePath('bin', 'repak.exe'),
    resourcePath('bin', 'palfont-font-helper.exe'),
    resourcePath('template', 'Pal', 'Content', 'Pal', 'Font', 'Ft_PalDefaultFont.uasset')
  ];
  const offlineReady = (await Promise.all(offlineFiles.map(fileExists))).every(Boolean);
  return {
    gameRunning: await isGameRunning(),
    gameFound: Boolean(resolvedGameRoot),
    gamePath: resolvedGameRoot,
    offlineReady,
    applyAvailable: offlineReady
  };
}

function progress(message) {
  mainWindow?.webContents.send('app:progress', message);
}

async function recordInstallFailure(error) {
  const logPath = path.join(app.getPath('userData'), 'installation-errors.log');
  const details = error?.details || error?.stack || String(error);
  await fs.appendFile(logPath, `[${new Date().toISOString()}]\n${details}\n\n`, 'utf8');
}

async function buildOfflinePak(fontPath, inspected, axisValues = {}) {
  const buildRoot = path.join(app.getPath('userData'), 'offline-build', crypto.randomUUID());
  const inputRoot = path.join(buildRoot, 'input');
  const outputPak = path.join(buildRoot, CONFIG.pakName);
  try {
    await fs.mkdir(buildRoot, { recursive: true });
    await fs.cp(resourcePath('template'), inputRoot, { recursive: true });

    let staticFont = fontPath;
    if (inspected.variable) {
      staticFont = path.join(buildRoot, 'selected-static-font.ttf');
      const availableAxes = new Map(inspected.axes.map(axis => [axis.tag, axis]));
      const args = ['instantiate', fontPath, staticFont];
      for (const [tag, rawValue] of Object.entries(axisValues || {})) {
        const axis = availableAxes.get(tag);
        const value = Number(rawValue);
        if (!axis || !Number.isFinite(value) || value < axis.min || value > axis.max) {
          throw new Error('Variable Font 参数无效。');
        }
        args.push('--axis', `${tag}=${value}`);
      }
      await run(resourcePath('bin', 'palfont-font-helper.exe'), args);
    }

    const fontData = await fs.readFile(staticFont);
    const fontRoot = path.join(inputRoot, 'Pal', 'Content', 'Pal', 'Font', 'NotoSans_SC');
    for (const weight of ['Black', 'Bold', 'Medium', 'Regular', 'Thin']) {
      await fs.writeFile(path.join(fontRoot, `NotoSansSC-${weight}.ufont`), fontData);
    }
    await run(resourcePath('bin', 'repak.exe'), [
      'pack', '--version', 'V11', '--mount-point', '../../../', inputRoot, outputPak
    ]);
    if (!await fileExists(outputPak)) throw new Error('离线 Pak 生成失败。');
    return { outputPak, buildRoot };
  } catch (error) {
    await fs.rm(buildRoot, { recursive: true, force: true });
    throw error;
  }
}

async function installPak(builtPak, resolvedGameRoot) {
  const modsDir = path.join(resolvedGameRoot, 'Pal', 'Content', 'Paks', '~mods');
  const installedPak = path.join(modsDir, CONFIG.pakName);
  const backupRoot = path.join(app.getPath('userData'), 'backups');
  await fs.mkdir(modsDir, { recursive: true });
  await fs.mkdir(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  if (await fileExists(installedPak)) {
    const backup = path.join(backupRoot, `${stamp}-${CONFIG.pakName}`);
    await fs.copyFile(installedPak, backup);
    if (await sha256(installedPak) !== await sha256(backup)) throw new Error('现有字体 Pak 备份校验失败。');
  }
  for (const entry of await fs.readdir(modsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^(?:zzz_)?palfont.*\.pak$/i.test(entry.name) || entry.name === CONFIG.pakName) continue;
    const original = path.join(modsDir, entry.name);
    const backup = path.join(backupRoot, `${stamp}-legacy-${entry.name}`);
    await fs.copyFile(original, backup);
    if (await sha256(original) !== await sha256(backup)) throw new Error(`旧字体 Mod 备份校验失败：${entry.name}`);
    await fs.unlink(original);
  }
  await fs.copyFile(builtPak, installedPak);
  if (await sha256(builtPak) !== await sha256(installedPak)) throw new Error('新字体 Pak 安装校验失败。');
  return installedPak;
}

async function applyFont(fontPath, axisValues = {}) {
  if (!fontPath || !['.ttf', '.otf'].includes(path.extname(fontPath).toLowerCase())) {
    throw new Error('仅支持 .ttf 和 .otf 字体。');
  }
  const inspected = await inspectFont(fontPath);
  const status = await getStatus();
  if (status.gameRunning) throw new Error('请先退出 Palworld。');
  if (!status.gameFound) throw new Error('未找到 Palworld。');
  if (!status.offlineReady) throw new Error('离线构建组件不完整。');

  progress('正在导入字体…');
  const { outputPak, buildRoot } = await buildOfflinePak(fontPath, inspected, axisValues);
  try {
    const installedPak = await installPak(outputPak, status.gamePath);
    return { installedPak };
  } finally {
    await fs.rm(buildRoot, { recursive: true, force: true });
  }
}

async function restoreDefault() {
  if (await isGameRunning()) throw new Error('请先退出 Palworld。');
  const resolvedGameRoot = await gameRoot();
  if (!resolvedGameRoot) throw new Error('未找到 Palworld。');
  const statePath = path.join(app.getPath('userData'), '.palfont-state.json');
  const modsRoot = path.resolve(resolvedGameRoot, 'Pal', 'Content', 'Paks', '~mods');
  const backupRoot = path.join(app.getPath('userData'), 'backups', `restore-default-${new Date().toISOString().replaceAll(':', '-')}`);
  let removedCount = 0;

  if (await fileExists(modsRoot)) {
    const candidates = (await fs.readdir(modsRoot, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^(?:zzz_)?palfont.*\.pak$/i.test(entry.name));

    if (candidates.length) await fs.mkdir(backupRoot, { recursive: true });
    for (const entry of candidates) {
      const target = path.resolve(modsRoot, entry.name);
      if (path.dirname(target).toLowerCase() !== modsRoot.toLowerCase()) {
        throw new Error('安全检查失败：字体 Pak 路径无效。');
      }
      const backup = path.join(backupRoot, entry.name);
      await fs.copyFile(target, backup);
      if (await sha256(target) !== await sha256(backup)) {
        throw new Error(`字体 Pak 备份校验失败：${entry.name}`);
      }
      await fs.unlink(target);
      removedCount += 1;
    }
  }

  if (await fileExists(statePath)) await fs.unlink(statePath);
  return { restored: true, removedCount };
}

ipcMain.handle('font:load', (_event, fontPath) => loadFont(fontPath));
ipcMain.handle('font-library:open', () => { createFontLibraryWindow(); return true; });
ipcMain.handle('font-library:list', listSystemFonts);
ipcMain.handle('font-library:select', async (_event, fontPath) => {
  const selected = await loadFont(fontPath);
  mainWindow.webContents.send('font:selected', selected);
  fontLibraryWindow?.close();
  return true;
});
ipcMain.handle('app:status', getStatus);
ipcMain.handle('game:select-path', selectGameRoot);
ipcMain.handle('font:apply', async (_event, fontPath, axisValues) => {
  if (installInProgress) throw new Error('安装失败');
  installInProgress = true;
  try { return await applyFont(fontPath, axisValues); }
  catch (error) {
    try { await recordInstallFailure(error); } catch { }
    if (String(error?.message).includes('请先退出 Palworld')) throw new Error('请先退出 Palworld。');
    if (String(error?.message).includes('未找到 Palworld')) throw new Error('未找到 Palworld。');
    throw new Error('安装失败');
  }
  finally { installInProgress = false; }
});
ipcMain.handle('font:restore-default', restoreDefault);

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
