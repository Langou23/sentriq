# SentriQ

[Français](#français) · [English](#english)

## Français

### Vision

SentriQ est une plateforme SaaS bilingue français/anglais destinée aux agences de
sécurité privée du Québec. Elle vise à centraliser le suivi des agents, les
événements de terrain et la coordination des opérations quotidiennes.

### Stack

- **Next.js App Router** : application web avec fondations PWA.
- **TypeScript strict** : typage du code applicatif.
- **Tailwind CSS** : styles et mise en page.
- **shadcn/ui** : composants d'interface.
- **Supabase hébergé** : backend de la plateforme.

### Prérequis

- **Node.js 22.x**.
- **npm 10 ou supérieur** ; le dépôt déclare npm 10.9.8.
- Un projet Supabase hébergé pour utiliser la connexion Supabase en local.

### Démarrage et commandes utiles

Exécuter toutes les commandes depuis la racine du monorepo :

| Commande            | Usage                                     |
| ------------------- | ----------------------------------------- |
| `npm ci`            | Installer les dépendances du lockfile.    |
| `npm run dev`       | Démarrer le serveur de développement.     |
| `npm run build`     | Créer le build de production.             |
| `npm run lint`      | Vérifier les règles ESLint.               |
| `npm run typecheck` | Vérifier les types et les routes Next.js. |

L'application est accessible par défaut sur [localhost:3000](http://localhost:3000).
Sans session, les routes protégées redirigent vers le formulaire bilingue `/login`.
Un compte Auth et un profil actif doivent déjà exister : la connexion redirige
vers `/agent`, `/dispatch` ou `/admin` selon le rôle. Ces pages seront créées
à l'étape 4 et retournent pour l'instant une 404. Le fonctionnement est décrit dans le
[module auth](apps/web/modules/auth/README.md).
Sous PowerShell, utiliser `npm.cmd` si l'exécution de `npm.ps1` est bloquée.
Arrêter le serveur de développement avant de lancer un build de production.

Pour configurer Supabase, renseigner ces variables dans `apps/web/.env.local`
avec les valeurs du projet hébergé :

- `NEXT_PUBLIC_SUPABASE_URL` : URL racine du projet, sans `/rest/v1/`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` : clé publique anon du projet.

Le fichier `.env.local` est ignoré par Git et ne doit jamais être commité.
La route `/health` vérifie la connexion à Supabase. Docker et la CLI Supabase
ne sont pas nécessaires pour cette configuration hébergée.

### Structure du monorepo

| Dossier     | Rôle                                                                  |
| ----------- | --------------------------------------------------------------------- |
| `apps/`     | Applications ; `apps/web/` contient l'application Next.js.            |
| `packages/` | Réservé aux futurs packages partagés : UI, validation et code commun. |
| `supabase/` | Réservé aux migrations versionnées et aux données initiales.          |
| `tests/`    | Réservé aux tests ; `tests/e2e/` accueillera les tests Playwright.    |
| `docs/`     | Réservé à la documentation, avec `architecture/` et `decisions/`.     |

Les conventions permanentes sont définies dans [AGENTS.md](AGENTS.md).
La CI vérifie lint, typecheck et build sur chaque push et pull request vers `main`.

### Roadmap v1

Fondations et fonctionnalités prévues pour la v1 :

- Fondations du monorepo, de l'application et de la CI — terminées.
- Authentification par matricule.
- Check-in/out : prise et fin de service.
- Gestion des incidents.
- Main courante.
- Tableau dispatch pour la coordination des opérations.

### Roadmap v2

- Planning.
- Rondes QR.
- Gestion multi-agences.
- Portail client.
- Ressources humaines (RH).
- Audit.
- IA Copilot.

### Statut

- **Bloc 01 (Fondations) : terminé.**
- **Bloc 02 (Auth) : en cours — modèle de données, session et connexion bilingue ; pages par rôle à venir.**

## English

### Vision

SentriQ is a bilingual French/English SaaS platform for private security agencies
in Quebec. It aims to centralize guard activity tracking, field events, and
day-to-day operational coordination.

### Stack

- **Next.js App Router**: web application with PWA foundations.
- **Strict TypeScript**: application code typing.
- **Tailwind CSS**: styling and layout.
- **shadcn/ui**: interface components.
- **Hosted Supabase**: platform backend.

### Prerequisites

- **Node.js 22.x**.
- **npm 10 or later**; the repository declares npm 10.9.8.
- A hosted Supabase project to use the Supabase connection locally.

### Getting started and useful commands

Run all commands from the monorepo root:

| Command             | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `npm ci`            | Install dependencies from the lockfile.   |
| `npm run dev`       | Start the development server.             |
| `npm run build`     | Create the production build.              |
| `npm run lint`      | Check ESLint rules.                       |
| `npm run typecheck` | Check types and generated Next.js routes. |

The application is available at [localhost:3000](http://localhost:3000) by default.
Without a session, protected routes redirect to the bilingual `/login` form.
An Auth account and an active profile must already exist: sign-in redirects to
`/agent`, `/dispatch`, or `/admin` based on the role. These pages will be created
in step 4 and currently return 404. The flow is documented in the
[auth module](apps/web/modules/auth/README.md).
In PowerShell, use `npm.cmd` if running `npm.ps1` is blocked.
Stop the development server before running a production build.

To configure Supabase, set these variables in `apps/web/.env.local` using the
hosted project's values:

- `NEXT_PUBLIC_SUPABASE_URL`: project root URL, without `/rest/v1/`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: project public anon key.

The `.env.local` file is ignored by Git and must never be committed.
The `/health` route checks the Supabase connection. Docker and the Supabase CLI
are not required for this hosted setup.

### Monorepo structure

| Directory   | Purpose                                                            |
| ----------- | ------------------------------------------------------------------ |
| `apps/`     | Applications; `apps/web/` contains the Next.js application.        |
| `packages/` | Reserved for shared packages: UI, validation, and common code.     |
| `supabase/` | Reserved for versioned migrations and seed data.                   |
| `tests/`    | Reserved for tests; `tests/e2e/` will contain Playwright tests.    |
| `docs/`     | Reserved for documentation, with `architecture/` and `decisions/`. |

Permanent conventions are defined in [AGENTS.md](AGENTS.md).
CI checks lint, typecheck, and build on every push and pull request targeting `main`.

### Roadmap v1

Foundations and features planned for v1:

- Monorepo, application, and CI foundations — complete.
- Employee ID sign-in.
- Check-in/out: start and end of duty.
- Incident management.
- Daily activity log (main courante).
- Dispatch dashboard for operational coordination.

### Roadmap v2

- Scheduling.
- QR patrols.
- Multi-agency management.
- Client portal.
- Human resources (HR).
- Audit.
- AI Copilot.

### Status

- **Block 01 (Foundations): complete.**
- **Block 02 (Auth): in progress — data model, sessions, and bilingual sign-in; role pages upcoming.**
