# Ponto Extra · Manutenção

Sistema web para registrar, revisar e controlar horas extras da equipe de manutenção. O lançamento começa na **batida de saída do ponto normal** e termina na saída final informada pelo manutentor.

A aplicação foi criada para substituir o preenchimento manual de folhas e planilhas por um fluxo simples, rastreável e acessível pelo computador ou celular.

**Produção:** [horaextramanutencao.vercel.app](https://horaextramanutencao.vercel.app/)

## O que o sistema faz

- Login individual com e-mail e senha.
- Cadastro com aprovação do administrador.
- Registro de data, batida do ponto, saída final e observação.
- Cálculo automático da hora extra, inclusive quando termina no dia seguinte.
- Fluxo de aprovação: pendente, aprovada ou devolvida com motivo.
- Histórico das alterações de cada lançamento.
- Dashboard com horas aprovadas, pendências, lançamentos por manutentor e gráficos.
- Relatório mensal em Excel seguindo o modelo da empresa.
- Administração de usuários, funções e permissões.
- Exclusão de lançamentos pelo administrador, com confirmação e atualização dos totais.
- Demonstração com dados fictícios, sem gravar informações reais.

## Perfis de acesso

| Perfil | Acesso |
| --- | --- |
| **Administrador** | Usuários, permissões, lançamentos, aprovação, relatórios e exclusões |
| **Gestor** | Dashboard, análise de lançamentos e, quando permitido, relatórios |
| **Manutentor** | Seus próprios lançamentos e respectivos status |

## Como funciona o lançamento

1. O manutentor informa a data.
2. Informa a batida de saída do expediente normal.
3. Informa a saída final da hora extra.
4. O sistema calcula a diferença automaticamente.
5. O gestor ou administrador aprova ou devolve para correção.
6. Somente lançamentos aprovados entram no relatório mensal.

A entrada normal é opcional e serve para registro na planilha. O cálculo usa a batida do ponto como início da hora extra.

## Demonstração

Para abrir a versão fictícia, acrescente `?demo=1` ao endereço:

```text
https://horaextramanutencao.vercel.app/?demo=1
```

Na demonstração é possível alternar entre administrador, gestor e manutentores. Os dados são fictícios e não alteram o banco real.

## Tecnologias

- React 19
- TypeScript
- Vite
- Supabase Auth e PostgreSQL
- Row Level Security (RLS)
- Lucide React
- Geração local de planilhas `.xlsx`
- Vercel

## Instalação local

Requisitos:

- Node.js 20.19 ou superior
- npm
- Um projeto Supabase configurado

No Windows PowerShell, use os comandos com `.cmd` caso a execução de scripts esteja bloqueada:

```powershell
npm.cmd install
npm.cmd run dev
```

Depois, abra a URL exibida pelo Vite. Para validar a aplicação antes de conectar ao banco, use `?demo=1`.

## Variáveis de ambiente

Para usar o Supabase localmente, copie `.env.production` para `.env.local` ou crie um arquivo com:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua-chave-publica
```

Nunca coloque `service_role`, senha do banco ou qualquer chave secreta em uma variável `VITE_`.

## Publicação na Vercel

```powershell
npm.cmd run build
vercel.cmd --prod
```

O projeto já usa a pasta `dist` como saída. Depois da publicação, configure no Supabase:

- **Site URL:** endereço oficial da aplicação.
- **Redirect URLs:** endereço oficial e endereços locais usados nos testes.

## Testes e validação

```powershell
npm.cmd test
npm.cmd run build
```

O build valida o TypeScript e gera a versão de produção. O teste da planilha verifica a estrutura do arquivo Excel e a soma das horas aprovadas.

## Banco de dados

As migrações ficam em `supabase/migrations/` e incluem:

- estrutura de perfis, lançamentos e histórico;
- aprovação administrativa de novos cadastros;
- fluxo de aprovação das horas;
- exclusão segura de perfis sem histórico;
- permissão de exclusão de lançamentos apenas para administradores ativos.

Se este repositório estiver conectado ao banco de produção atual, não execute as migrações novamente. Use-as apenas ao configurar um banco novo.

## Estrutura principal

```text
src/
├── main.tsx             # telas e fluxo da aplicação
├── lib/supabase.ts      # autenticação e operações no banco
├── lib/report.ts        # exportação do relatório Excel
├── lib/demo.ts          # dados fictícios da demonstração
└── lib/time.ts          # cálculo e formatação dos horários

supabase/
├── migrations/          # estrutura e políticas do banco
└── bootstrap-admin.sql  # instalação em banco novo
```

## Regras atuais

- A hora extra começa na batida de saída do expediente normal.
- O lançamento pode atravessar a meia-noite quando essa opção é marcada.
- O intervalo aceito é de 1 minuto a 16 horas por lançamento.
- Gestores e administradores podem aprovar ou devolver lançamentos conforme suas permissões.
- Apenas horas aprovadas entram nos totais e relatórios.
- A exclusão de um lançamento é definitiva e remove também seu histórico.

## Próximas evoluções possíveis

- Campo para escolher adicional de 50% ou 100% por lançamento.
- Notificação automática quando um cadastro for aprovado.
- Integração com o relógio de ponto da empresa.
- Backup periódico dos relatórios.
- Filtros avançados por setor, período e aprovador.

## Autor

Projeto desenvolvido por **Lucas Bandeira** para organizar o controle de horas extras da equipe de manutenção.
