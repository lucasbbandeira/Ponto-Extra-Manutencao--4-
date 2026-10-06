'use strict';

// Aplicação local: não acessa a internet, o Supabase ou a Vercel.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(process.cwd());
const packageRoot = path.resolve(__dirname);
const payloadRoot = path.join(packageRoot, 'ARQUIVOS-RELATORIOS');
const expectedProject = 'temporary-fast-gust-egqo2qb';
const allowedFiles = ['src/main.tsx', 'src/style.css', 'src/lib/report.ts', 'src/lib/report.test.mjs'];
const mode = process.argv[2] || '';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fail(message) { throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function checkLocalPath(relative) {
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      fail('A atualização parou porque há um atalho simbólico no caminho: ' + relative);
    }
  }
}

function verifySource(manifest) {
  for (const file of allowedFiles) {
    if (hash(path.join(root, file)) !== manifest.files[file]) {
      fail('A atualização ainda não foi aplicada em ' + file + '. Execute node .\\APLICAR-RELATORIOS.cjs primeiro.');
    }
  }
}

function verifyBuild(manifest) {
  verifySource(manifest);
  const htmlFile = path.join(root, 'dist', 'index.html');
  if (!fs.existsSync(htmlFile)) fail('O build não existe. Execute npm.cmd run build.');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const asset = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"/);
  if (!asset) fail('Não foi possível encontrar o JavaScript do build. Execute npm.cmd run build novamente.');
  const relative = asset[1].replace(/^\/+/, '');
  const jsFile = path.resolve(root, 'dist', relative);
  const distRoot = path.resolve(root, 'dist') + path.sep;
  if (!jsFile.startsWith(distRoot)) fail('O build contém um caminho inesperado.');
  const js = fs.readFileSync(jsFile, 'utf8');
  for (const marker of ['Relatórios por manutentor.', 'Escolha o manutentor', 'Total do manutentor']) {
    if (!js.includes(marker)) fail('O build ainda está com os relatórios antigos. Execute npm.cmd run build nesta pasta.');
  }
  if (js.includes('com as abas Lançamentos, Cadastro e uma aba individual')) {
    fail('O build ainda contém a tela antiga de relatórios.');
  }
  console.log('\nBUILD VERIFICADO: os relatórios individuais estão na versão compilada.');
  console.log('Arquivo: ' + path.basename(jsFile));
  console.log('Agora publique no mesmo projeto: vercel.cmd --prod');
}

function apply(manifest) {
  const changed = allowedFiles.filter(file => hash(path.join(root, file)) !== manifest.files[file]);
  if (!changed.length) {
    console.log('\nOs arquivos desta atualização já estão aplicados.');
  } else {
    // O backup fica ao lado do projeto, fora da pasta que será publicada.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(path.dirname(root), 'Backup-Hora-Extra-Relatorios-' + stamp);
    fs.mkdirSync(backup, { recursive: false });
    for (const file of changed) {
      const saved = path.join(backup, file);
      fs.mkdirSync(path.dirname(saved), { recursive: true });
      fs.copyFileSync(path.join(root, file), saved);
    }
    try {
      for (const file of changed) fs.copyFileSync(path.join(payloadRoot, file), path.join(root, file));
      verifySource(manifest);
    } catch (error) {
      for (const file of changed) fs.copyFileSync(path.join(backup, file), path.join(root, file));
      fail('Os arquivos anteriores foram restaurados. Motivo: ' + error.message);
    }
    console.log('\nATUALIZAÇÃO APLICADA COM SUCESSO.');
    console.log('Cópia de segurança: ' + backup);
  }
  console.log('Pasta atualizada: ' + root);
  console.log('Próximos comandos, um por vez:');
  console.log('  npm.cmd run build');
  console.log('  node .\\APLICAR-RELATORIOS.cjs --verificar-build');
  console.log('  vercel.cmd --prod');
  console.log('No site, abra Relatórios e procure "Escolha o manutentor".');
}

try {
  if (!['', '--verificar-build'].includes(mode) || process.argv.length > 3) {
    fail('Use node .\\APLICAR-RELATORIOS.cjs ou node .\\APLICAR-RELATORIOS.cjs --verificar-build.');
  }
  if (root !== packageRoot) fail('Abra o terminal na pasta ORIGINAL do projeto, onde estão package.json e este arquivo.');
  if (!fs.existsSync(path.join(root, 'package.json'))) {
    fail('Esta é a pasta do ZIP, não a pasta do projeto. Copie APLICAR-RELATORIOS.cjs e ARQUIVOS-RELATORIOS para a pasta onde está package.json.');
  }
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg.name !== 'horas-ponto-manutencao') fail('Esta pasta pertence a outro projeto. Nenhum arquivo foi alterado.');
  const linkFile = path.join(root, '.vercel', 'project.json');
  if (!fs.existsSync(linkFile)) fail('Esta pasta não tem a vinculação da Vercel. Abra a pasta ORIGINAL que você já usou para publicar o site.');
  const link = readJson(linkFile);
  if (!link.projectId || !link.orgId || (link.projectName && link.projectName !== expectedProject)) {
    fail('A vinculação da Vercel não corresponde ao projeto esperado. Nenhum arquivo foi alterado.');
  }
  const apiFile = path.join(root, 'src', 'lib', 'supabase.ts');
  const demoFile = path.join(root, 'src', 'lib', 'demo.ts');
  if (![apiFile, demoFile].every(file => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('deleteEntry'))) {
    fail('A pasta está sem uma atualização anterior do sistema. Use a pasta atual que já permite excluir lançamentos.');
  }
  const manifest = readJson(path.join(payloadRoot, 'verificacao.json'));
  if (manifest.version !== 'relatorios-individuais-2026-10-06' ||
      !manifest.files || Object.keys(manifest.files).sort().join('|') !== [...allowedFiles].sort().join('|')) {
    fail('O pacote está incompleto. Extraia o ZIP novamente.');
  }
  for (const file of allowedFiles) {
    checkLocalPath(file);
    if (!fs.existsSync(path.join(root, file))) fail('Falta ' + file + ' na pasta do projeto. Nenhum arquivo foi alterado.');
    if (hash(path.join(payloadRoot, file)) !== manifest.files[file]) fail('O arquivo do pacote está incompleto: ' + file + '. Extraia o ZIP novamente.');
  }
  if (mode === '--verificar-build') verifyBuild(manifest);
  else apply(manifest);
} catch (error) {
  console.error('\nATUALIZAÇÃO INTERROMPIDA: ' + error.message);
  console.error('Não publique enquanto essa mensagem não for resolvida.');
  process.exitCode = 1;
}
