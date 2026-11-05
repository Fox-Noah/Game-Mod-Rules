const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'source');
const rulesDir = path.join(root, 'rules');
const manifestPath = path.join(root, 'manifest.json');
const key = Buffer.from(fs.readFileSync(path.join(root, '.rules-key'), 'utf8').trim(), 'hex');

const pad = (value) => String(value).padStart(2, '0');
const formatTime = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { games: {} };
const manifest = { games: {} };
const snapshotFiles = {};
const changed = [];
fs.mkdirSync(rulesDir, { recursive: true });

for (const file of fs.readdirSync(sourceDir).filter(name => name.endsWith('.json'))) {
  const id = path.basename(file, '.json');
  const source = JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8'));
  const payload = { rules: source.rules || [] };
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const old = previous.games[id];
  let ruleVersion = Number.isFinite(source.ruleVersion) ? source.ruleVersion : 0;
  let updatedAt = old?.updatedAt;
  if (old && old.hash === hash) {
    ruleVersion = old.ruleVersion;
  } else {
    if (old) ruleVersion = Math.max(old.ruleVersion + 1, ruleVersion);
    updatedAt = formatTime(new Date());
  }
  // 规则没变且已有密文时沿用旧密文，只重新加密新增或修改的游戏（加密带随机数，重加密会让每个 .enc 都变）
  const encPath = path.join(rulesDir, `${id}.enc`);
  const unchanged = old && old.hash === hash && fs.existsSync(encPath);
  const encrypted = unchanged ? fs.readFileSync(encPath, 'utf8') : encrypt(JSON.stringify({ ruleVersion, rules: payload.rules }));
  if (!unchanged) {
    fs.writeFileSync(encPath, encrypted, 'utf8');
    changed.push(id);
  }
  snapshotFiles[id] = encrypted;
  manifest.games[id] = { version: String(ruleVersion), ruleVersion, hash, updatedAt };
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`共 ${Object.keys(manifest.games).length} 个游戏，重新加密 ${changed.length} 个${changed.length ? '：' + changed.join(', ') : ''}`);

const snapshotTarget = process.argv[2];
if (snapshotTarget) {
  const text = `// 内置规则离线快照（由 Game-Mod-Rules 的发布脚本生成，请勿手动修改）\nexport const BUILTIN_RULES_SNAPSHOT = ${JSON.stringify({ manifest, files: snapshotFiles }, null, 2)} as const;\n`;
  fs.writeFileSync(snapshotTarget, text, 'utf8');
  console.log('已写入快照', snapshotTarget);
}
