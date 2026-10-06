'use strict';

// Atualização local. Não acessa contas, banco de dados ou hospedagem.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(process.cwd());
const payloadRoot = path.join(__dirname, 'ARQUIVOS-HORA-EXTRA');
const expectedProjectId = 'prj_yxElDx9176PuRcnXn9SefuFPOLGY';
const expectedOrgId = 'team_OdtVOMiyLNXfZJuMh2LfqUCR';
const expectedProjectName = 'temporary-fast-gust-egqo2qb';
const mode = process.argv[2] || '';
const files = [
  'src/main.tsx', 'src/style.css', 'src/lib/types.ts', 'src/lib/time.ts',
  'src/lib/supabase.ts', 'src/lib/demo.ts', 'src/lib/report.ts',
  'src/lib/time.test.mjs', 'src/lib/report.test.mjs',
  'supabase/migrations/20261006034144_overtime_start_required_fields.sql',
];
const optionalFiles = new Set(files.slice(7));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const hash = file => sha(fs.readFileSync(file));
const sourceHash = file => sha(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function fail(message) { throw new Error(message); }

function checkPath(base, relative) {
  let current = base;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      fail('Há um atalho simbólico no caminho ' + relative + '. Nenhum arquivo foi alterado.');
    }
  }
}

function verifySource(manifest) {
  for (const file of files) {
    if (!fs.existsSync(path.join(root, file)) || sourceHash(path.join(root, file)) !== manifest.updated[file]) {
      fail('Falta aplicar esta atualização em ' + file + '. Execute node .\\APLICAR-HORA-EXTRA.cjs.');
    }
  }
}

function verifyBuild(manifest) {
  verifySource(manifest);
  const htmlFile = path.join(root, 'dist', 'index.html');
  if (!fs.existsSync(htmlFile)) fail('Execute npm.cmd run build antes de verificar.');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const asset = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"/);
  if (!asset) fail('Não foi encontrado o JavaScript compilado. Execute npm.cmd run build.');
  const jsFile = path.resolve(root, 'dist', asset[1].replace(/^\/+/, ''));
  if (!jsFile.startsWith(path.resolve(root, 'dist') + path.sep) || !fs.existsSync(jsFile)) {
    fail('O build contém um caminho inesperado.');
  }
  const js = fs.readFileSync(jsFile, 'utf8');
  for (const marker of ['Início da hora extra', 'Término da hora extra', 'Descrição do serviço',
    'submit_entry_v2', 'revise_entry_v2', 'p_overtime_start',
    'Relatórios por manutentor.', 'Escolha o manutentor']) {
    if (!js.includes(marker)) fail('O build não contém a atualização completa. Execute npm.cmd run build nesta pasta.');
  }
  const latestSource = Math.max(...files.slice(0, 7).map(file => fs.statSync(path.join(root, file)).mtimeMs));
  if (fs.statSync(htmlFile).mtimeMs + 2000 < latestSource) fail('O build é anterior aos arquivos atualizados. Execute npm.cmd run build.');
  console.log('\nBUILD VERIFICADO: formulário, cálculo e relatórios estão atualizados.');
  console.log('Agora publique: vercel.cmd --prod');
}

function apply(manifest) {
  const changed = files.filter(file => !fs.existsSync(path.join(root, file)) || sourceHash(path.join(root, file)) !== manifest.updated[file]);
  if (!changed.length) {
    console.log('\nEsta atualização já está aplicada na pasta do projeto.');
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(path.dirname(root), 'Backup-Hora-Extra-Inicio-' + stamp);
    fs.mkdirSync(backup);
    const originals = changed.map(file => ({ file, existed: fs.existsSync(path.join(root, file)) }));
    for (const item of originals.filter(item => item.existed)) {
      const saved = path.join(backup, item.file);
      fs.mkdirSync(path.dirname(saved), { recursive: true });
      fs.copyFileSync(path.join(root, item.file), saved);
    }
    fs.writeFileSync(path.join(backup, 'arquivos.json'), JSON.stringify(originals, null, 2));
    try {
      for (const file of changed) {
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(payloadRoot, file), target);
      }
      verifySource(manifest);
    } catch (error) {
      for (const item of originals) {
        const target = path.join(root, item.file);
        if (item.existed) fs.copyFileSync(path.join(backup, item.file), target);
        else if (fs.existsSync(target)) fs.unlinkSync(target);
      }
      fail('Os arquivos anteriores foram restaurados. Motivo: ' + error.message);
    }
    console.log('\nATUALIZAÇÃO APLICADA COM SUCESSO.');
    console.log('Cópia de segurança: ' + backup);
  }
  console.log('Pasta atualizada: ' + root);
  console.log('Próximos comandos, um por vez:');
  console.log('  npm.cmd run build');
  console.log('  node .\\APLICAR-HORA-EXTRA.cjs --verificar-build');
  console.log('  vercel.cmd --prod');
  console.log('O banco já foi atualizado. Não execute os SQL antigos.');
}

try {
  if (!['', '--verificar-build'].includes(mode) || process.argv.length > 3) fail('Use node .\\APLICAR-HORA-EXTRA.cjs ou acrescente --verificar-build.');
  if (root !== path.resolve(__dirname)) fail('Abra o terminal na pasta do projeto onde você copiou este arquivo.');
  if (!fs.existsSync(path.join(root, 'package.json'))) fail('Esta é a pasta do ZIP. Copie APLICAR-HORA-EXTRA.cjs e ARQUIVOS-HORA-EXTRA para a pasta original onde está package.json.');
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg.name !== 'horas-ponto-manutencao') fail('Esta pasta pertence a outro projeto. Nenhum arquivo foi alterado.');
  const linkFile = path.join(root, '.vercel', 'project.json');
  if (!fs.existsSync(linkFile)) fail('Abra a pasta original que já está vinculada à Vercel e que você usou na última publicação.');
  const link = readJson(linkFile);
  if (link.projectId !== expectedProjectId || link.orgId !== expectedOrgId || (link.projectName && link.projectName !== expectedProjectName)) {
    fail('Esta pasta está vinculada a outro projeto da Vercel. Abra a pasta do site horaextramanutencao.vercel.app.');
  }
  const manifestFile = path.join(payloadRoot, 'verificacao.json');
  if (!fs.existsSync(manifestFile)) fail('Copie também a pasta ARQUIVOS-HORA-EXTRA.');
  const manifest = readJson(manifestFile);
  if (manifest.version !== 'inicio-extra-2026-10-06' || !manifest.files || !manifest.updated || !manifest.baseline ||
    Object.keys(manifest.files).sort().join('|') !== [...files].sort().join('|')) fail('O pacote está incompleto. Extraia o ZIP novamente.');
  for (const file of files) {
    checkPath(root, file);
    checkPath(payloadRoot, file);
    const payload = path.join(payloadRoot, file);
    const target = path.join(root, file);
    if (!fs.existsSync(payload) || hash(payload) !== manifest.files[file]) fail('O arquivo do pacote está incompleto: ' + file + '. Extraia o ZIP novamente.');
    if (!fs.existsSync(target)) {
      if (!optionalFiles.has(file)) fail('Falta ' + file + '. Abra a pasta original completa do projeto.');
    } else if (![manifest.updated[file], manifest.baseline[file]].includes(sourceHash(target))) {
      fail('O arquivo ' + file + ' está diferente da versão esperada. Nenhum arquivo foi alterado. Envie essa mensagem ao ChatGPT antes de publicar.');
    }
  }
  if (mode === '--verificar-build') verifyBuild(manifest);
  else apply(manifest);
} catch (error) {
  console.error('\nATUALIZAÇÃO INTERROMPIDA: ' + error.message);
  console.error('Não publique enquanto essa mensagem não for resolvida.');
  process.exitCode = 1;
}
