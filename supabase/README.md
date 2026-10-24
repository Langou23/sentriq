# Supabase

## Français

### Appliquer le modèle des profils

La migration versionnée est
[`migrations/20261022034112_create_auth_profiles.sql`](migrations/20261022034112_create_auth_profiles.sql).
Le fichier contient une transaction complète à exécuter une seule fois :

1. Ouvrir le projet Supabase dans le dashboard, puis **SQL Editor → New query**.
2. Utiliser le rôle d'administration `postgres`.
3. Copier tout le contenu du fichier SQL, de `begin;` à `commit;`, puis exécuter.
4. Vérifier la présence de `public.profiles`, de son enum et de ses politiques RLS.

L'exécution manuelle dans SQL Editor n'enregistre pas automatiquement la version
dans l'historique de migration de la CLI. Si la CLI est adoptée plus tard,
synchroniser cet historique avant tout `db push` ; ne pas réexécuter ce SQL.

### Matricules numériques

Après le modèle des profils, exécuter aussi la migration
[`migrations/20261022210328_require_numeric_badge_numbers.sql`](migrations/20261022210328_require_numeric_badge_numbers.sql)
dans SQL Editor avec le rôle `postgres`. Elle impose uniquement les chiffres `0–9`.
`badge_number` reste de type `text` pour conserver les zéros initiaux (`000001`).
Si des matricules existants contiennent d'autres caractères, la transaction échoue
sans modifier les données ; le commentaire SQL fournit une requête de diagnostic.
Corriger ces identités et leurs emails Auth correspondants de façon explicite avant
de réexécuter la migration. Aucun compte hébergé n'est créé par les fixtures locales.

### Accès applicatifs

| Identité     | Lecture          | Mise à jour                                                      |
| ------------ | ---------------- | ---------------------------------------------------------------- |
| Non connecté | Aucune           | Aucune                                                           |
| Agent        | Son profil       | Son matricule, prénom et nom                                     |
| Supervisor   | Tous les profils | Son matricule, prénom et nom                                     |
| Admin        | Tous les profils | Ses champs personnels ; rôle et statut actif de tous les profils |

Les clients ne peuvent ni créer ni supprimer un profil, ni modifier son `id`,
son `created_at` ou directement son `updated_at`. Un trigger actualise `updated_at`.
Les créations et l'attribution initiale d'un administrateur nécessitent un
provisionnement de confiance (`postgres` ou un backend avec `service_role`).
Ne jamais exposer la clé `service_role` au navigateur.

`current_user_role()` lit uniquement le rôle enregistré du profil associé à
`auth.uid()` et retourne `null` si ce profil n'existe pas. Elle n'utilise aucune
métadonnée modifiable du compte Auth. Cette migration ne crée aucun profil
automatiquement, aucune interface de connexion et aucun mécanisme de révocation
des sessions Auth lorsque `is_active` change.

Les vérifications des accès autorisés et refusés sont dans
[`tests/profiles_rls.sql`](tests/profiles_rls.sql).

### Pointage : sites, affectations et sessions

La nouvelle migration est
[`migrations/20261023153000_create_timekeeping.sql`](migrations/20261023153000_create_timekeeping.sql).
Elle dépend des deux migrations précédentes : profils, puis matricules numériques.
Si elles sont déjà appliquées au projet, ne pas les réexécuter.

Pour appliquer uniquement cette nouvelle migration au projet hébergé :

1. Ouvrir **SQL Editor → New query** dans le dashboard Supabase.
2. Sélectionner le rôle d'administration `postgres`.
3. Copier tout le fichier `20261023153000_create_timekeeping.sql`, de `begin;`
   à `commit;`, et l'exécuter une seule fois.
4. Vérifier les trois tables, leurs contraintes, leurs triggers et leurs politiques RLS.

Ces instructions décrivent une application manuelle ; elles ne confirment pas que
la migration a été exécutée sur le projet hébergé. L'historique de la CLI devra
être synchronisé avant un éventuel futur `db push`, comme pour les profils.

Le modèle comprend :

- `sites` : nom, adresse facultative, coordonnées, rayon en mètres et statut actif.
- `assignments` : lien entre un profil et un site, avec statut actif ; aucune
  planification d'horaires n'est introduite à cette étape.
- `work_sessions` : entrée et sortie, avec coordonnées, distance et indicateur
  de présence dans le rayon. Un index unique interdit plusieurs sessions ouvertes
  pour un même agent, même sur des sites différents.

Les sites actifs sont visibles aux utilisateurs connectés. Seul un administrateur
au profil actif peut aussi consulter les sites inactifs et créer ou modifier
des sites et des affectations depuis un client applicatif.

L'accès aux affectations et aux sessions exige un profil actif : un agent ne lit
que les siennes ; un superviseur ou administrateur peut toutes les lire.
Un agent actif ne peut ouvrir qu'une session à son nom, sur un site actif auquel
il possède une affectation active. Il peut uniquement clôturer sa propre session
ouverte, sans modifier les données d'entrée. La clôture reste autorisée si le site
ou l'affectation a été désactivé entre-temps, tant que son profil reste actif.
Les superviseurs et administrateurs n'ont pas d'écriture client sur les sessions.

Une session clôturée est immuable : un trigger refuse sa modification, y compris
via une API de confiance utilisant `service_role`. Les clients applicatifs et
`service_role` n'ont aucun droit `DELETE` sur ces trois tables. Le provisionnement
de confiance reste côté serveur ; ne jamais exposer de clé privilégiée au navigateur.

Les vérifications des accès autorisés et refusés sont dans
[`tests/timekeeping_rls.sql`](tests/timekeeping_rls.sql). Exécuter ce fichier
uniquement sur un projet Supabase de test jetable, avec les trois migrations déjà
appliquées. Il crée ses fixtures dans une transaction puis effectue un `rollback;` ;
ne pas l'utiliser comme migration ni comme seed du projet hébergé.

### Sites de démonstration pour l'agent 100001

Après les trois migrations, exécuter manuellement
[`seeds/demo_timekeeping.sql`](seeds/demo_timekeeping.sql) dans **SQL Editor → New query**,
avec le rôle `postgres`. Copier le fichier complet, de `begin;` à `commit;`.
Il crée deux sites fictifs bilingues « DEMO SENTRIQ », avec des coordonnées
illustratives à Montréal et un rayon de 150 m, puis affecte le profil actif de rôle
`agent` portant le matricule `100001` aux deux sites. Si ce profil manque ou est
inactif, le script échoue sans créer les sites.

Ce seed facultatif est distinct des migrations et des tests RLS avec rollback.
Il conserve les données de démonstration par `commit;` et n'est jamais exécuté
automatiquement. Une nouvelle exécution réutilise les sites et affectations ;
les UUID réservés ne peuvent pas remplacer un site portant un autre nom.
Le résultat attendu contient deux lignes avec `radius_m = 150`, `site_active = true`
et `assignment_active = true`. Aucun utilisateur Auth, mot de passe, profil ou
pointage n'est créé ou modifié.

## English

### Apply the profiles model

The versioned migration is
[`migrations/20261022034112_create_auth_profiles.sql`](migrations/20261022034112_create_auth_profiles.sql).
The file contains a complete transaction to run once:

1. Open the Supabase project dashboard, then **SQL Editor → New query**.
2. Use the administrative `postgres` role.
3. Copy the entire SQL file, from `begin;` through `commit;`, and run it.
4. Verify `public.profiles`, its enum, and its RLS policies exist.

Running SQL manually in SQL Editor does not automatically record its version in
the CLI migration history. If the CLI is adopted later, synchronize that history
before any `db push`; do not rerun this SQL.

### Numeric badge numbers

After the profiles model, also run
[`migrations/20261022210328_require_numeric_badge_numbers.sql`](migrations/20261022210328_require_numeric_badge_numbers.sql)
in SQL Editor using the `postgres` role. It requires digits `0–9` only.
`badge_number` stays `text` to preserve leading zeros (`000001`). If existing badges
contain other characters, the transaction fails without changing their data; a
SQL comment provides a diagnostic query. Resolve those identities and their matching
Auth emails explicitly before rerunning it. Local fixtures create no hosted accounts.

### Application access

| Identity   | Read         | Update                                                      |
| ---------- | ------------ | ----------------------------------------------------------- |
| Signed out | None         | None                                                        |
| Agent      | Own profile  | Own badge number, first name, and last name                 |
| Supervisor | All profiles | Own badge number, first name, and last name                 |
| Admin      | All profiles | Own personal fields; role and active status of all profiles |

Clients cannot create or delete profiles, change `id` or `created_at`, or write
`updated_at` directly. A trigger updates `updated_at` automatically. Profile
creation and the first administrator assignment require trusted provisioning
(`postgres` or a backend using `service_role`). Never expose the `service_role`
key to the browser.

`current_user_role()` reads only the stored role of the profile associated with
`auth.uid()`, returning `null` if no profile exists. It does not trust editable
Auth account metadata. This migration does not automatically create profiles,
add a sign-in interface, or revoke Auth sessions when `is_active` changes.

Allowed and denied access checks are in
[`tests/profiles_rls.sql`](tests/profiles_rls.sql).

### Timekeeping: sites, assignments, and sessions

The new migration is
[`migrations/20261023153000_create_timekeeping.sql`](migrations/20261023153000_create_timekeeping.sql).
It depends on both earlier migrations: profiles, then numeric badge numbers.
Do not rerun them if they are already applied to the project.

To apply only this new migration to the hosted project:

1. Open **SQL Editor → New query** in the Supabase dashboard.
2. Select the administrative `postgres` role.
3. Copy the entire `20261023153000_create_timekeeping.sql` file, from `begin;`
   through `commit;`, and run it once.
4. Verify the three tables, their constraints, triggers, and RLS policies.

These instructions describe a manual application; they do not confirm that the
migration has been executed on the hosted project. Synchronize CLI migration
history before any future `db push`, as with the profiles migration.

The model contains:

- `sites`: name, optional address, coordinates, radius in meters, and active status.
- `assignments`: a profile-to-site link with active status; this step introduces
  no scheduled working hours.
- `work_sessions`: check-in and checkout with coordinates, distance, and an
  indicator for being within the radius. A unique index prevents more than one
  open session per agent, including across different sites.

Signed-in users can read active sites. Only an administrator with an active
profile can also read inactive sites and create or update sites and assignments
through an application client.

Assignment and session access requires an active profile: agents read only their
own records; supervisors and administrators can read all of them. An active agent
can open a session only for themselves on an active site with an active assignment.
They can only close their own open session, without changing check-in data.
Checkout remains allowed if the site or assignment has since been deactivated,
provided the agent's profile is still active. Supervisors and administrators have
no client write access to sessions.

A closed session is immutable: a trigger rejects changes even through a trusted
API using `service_role`. Application clients and `service_role` have no `DELETE`
privilege on any of these three tables. Trusted provisioning stays server-side;
never expose a privileged key to the browser.

Allowed and denied access checks are in
[`tests/timekeeping_rls.sql`](tests/timekeeping_rls.sql). Run this file only on a
disposable Supabase test project with all three migrations already applied.
It creates fixtures inside a transaction and ends with `rollback;`; do not use
it as a migration or as a seed for the hosted project.

### Demo sites for agent 100001

After all three migrations, manually run
[`seeds/demo_timekeeping.sql`](seeds/demo_timekeeping.sql) in **SQL Editor → New query**
using the `postgres` role. Copy the entire file, from `begin;` through `commit;`.
It creates two bilingual fictional "DEMO SENTRIQ" sites with illustrative Montreal
coordinates and a 150 m radius, then assigns the active `agent` profile with badge
number `100001` to both sites. If that profile is missing or inactive, the script
fails without creating the sites.

This optional seed is separate from migrations and rollback-based RLS tests.
It persists demo data with `commit;` and never runs automatically. Rerunning it
reuses the sites and assignments; reserved UUIDs cannot replace a differently named
site. Expect two result rows with `radius_m = 150`, `site_active = true`, and
`assignment_active = true`. It does not create or modify Auth users, passwords,
profiles, or work sessions.
