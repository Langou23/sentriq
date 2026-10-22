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
