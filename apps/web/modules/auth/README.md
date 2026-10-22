# Authentication module

## Français

### Interface publique

| Point d'entrée              | Usage                                                          |
| --------------------------- | -------------------------------------------------------------- |
| `@/modules/auth`            | `badgeNumberToEmail`, `validateSignIn` et types sérialisables. |
| `@/modules/auth/actions`    | Server Actions `signIn`, `signInFromForm` et `signOut`.        |
| `@/modules/auth/login-form` | Composant public `LoginForm`, utilisé par `/login`.            |
| `@/modules/auth/proxy`      | Adaptateur de session `updateSession` pour le proxy Next.js.   |

`badgeNumberToEmail("  ab-001  ")` retourne `AB-001@sentriq.local`.
La normalisation conserve les zéros initiaux et ne modifie jamais le mot de passe.
Le compte Supabase Auth doit déjà exister avec cet email synthétique : ces actions
ne créent ni compte ni profil.

Les actions renvoient une erreur générique `{ success: false, code, message }`
avec `message.fr` et `message.en` en cas d'échec. Elles ne renvoient aucun jeton
ni erreur brute Supabase. Zod valide les champs non vides côté serveur et fournit
des erreurs de champ FR/EN sans renvoyer le mot de passe. Le formulaire reprend
l'affichage simultané FR puis EN de l'accueil, avec `lang="en"` sur les traductions.
Les identifiants refusés produisent toujours « Matricule ou mot de passe invalide. ».

Après authentification, `signIn` lit `role,is_active` dans `public.profiles` pour
l'identifiant Auth vérifié, via le client utilisateur et les politiques RLS.
Un profil absent ou inactif entraîne une déconnexion immédiate et le message
« Compte désactivé, contactez votre superviseur. ». Une erreur de lecture ou un
rôle inconnu bloque également la connexion avec une erreur d'indisponibilité.
Les nouveaux cookies de session restent différés jusqu'à validation du profil ;
ils sont supprimés en cas de refus, même si la révocation distante échoue.

Un profil actif redirige vers `/agent` (agent), `/dispatch` (supervisor) ou `/admin`
(admin). Ces destinations retournent une 404 jusqu'à l'étape 4. `signOut` redirige
vers `/login`. Les actions invalident le cache des layouts et la déconnexion est
limitée à la session courante (`scope: "local"`). Elles exigent l'écriture effective
des cookies ; un échec ne peut pas être présenté comme une connexion réussie.

### Session et routes

Le fichier `apps/web/proxy.ts` délègue au module auth. Chaque requête protégée
crée son propre client `@supabase/ssr` et appelle `auth.getUser()` pour vérifier
l'identité auprès de Supabase Auth. Le SDK rafraîchit une session expirée
lorsqu'un refresh token valide est disponible.

Les cookies mis à jour sont transmis à la requête suivante et à la réponse du
navigateur. Les suppressions de cookies et les en-têtes empêchant la mise en
cache sont conservés, y compris lors d'une redirection. Une session absente ou
invalide, ou un échec de vérification, entraîne une redirection vers `/login`.
Une redirection après POST utilise HTTP 303 pour ne pas rejouer le corps soumis.
`/login` rafraîchit aussi les cookies existants, tout en restant accessible même
sans session ou si Supabase est indisponible. `/health` évite ce contrôle Auth.

Seuls `/login` et `/health` sont des routes publiques. Les exceptions d'assets
sont explicites : `/_next/static/`, `/_next/image`, `/icons/`, `/favicon.ico`
et `/manifest.webmanifest`. Les API et les autres chemins ayant une extension
restent protégés. Ajouter les futurs assets publics à ce périmètre plutôt que
d'exclure tous les chemins contenant une extension.

`/login` retourne le formulaire avec HTTP 200. Le proxy vérifie la session Auth ;
le contrôle de profil décrit ci-dessus intervient lors de la connexion. Les futures
pages et opérations métier devront aussi vérifier leurs autorisations côté serveur,
avec RLS au niveau des données : une redirection de connexion n'est pas une règle
d'autorisation pour les opérations ultérieures.

## English

### Public interface

| Entry point                 | Purpose                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `@/modules/auth`            | `badgeNumberToEmail`, `validateSignIn`, and serializable types. |
| `@/modules/auth/actions`    | `signIn`, `signInFromForm`, and `signOut` Server Actions.       |
| `@/modules/auth/login-form` | Public `LoginForm` component, used by `/login`.                 |
| `@/modules/auth/proxy`      | `updateSession` session adapter for the Next.js proxy.          |

`badgeNumberToEmail("  ab-001  ")` returns `AB-001@sentriq.local`.
Normalization preserves leading zeros and never changes the password.
The Supabase Auth account must already exist with that synthetic email: these
actions create neither accounts nor profiles.

On failure, actions return a generic `{ success: false, code, message }` error
with `message.fr` and `message.en`. They return no tokens or raw Supabase errors.
Zod validates nonempty fields on the server and returns bilingual field errors,
never the password. The form follows the home page's simultaneous French then
English presentation, marking translations with `lang="en"`. Rejected credentials
always produce “Invalid badge number or password.”.

After authentication, `signIn` reads `role,is_active` from `public.profiles` for the
verified Auth user ID, using the user's client and RLS policies. A missing or
inactive profile immediately signs out with “Account disabled. Contact your
supervisor.”. Profile query failures and unknown roles also block sign-in with
an unavailable-service message. New session cookies are deferred until the profile
is approved; rejection clears them even if remote revocation fails.

An active profile redirects to `/agent` (agent), `/dispatch` (supervisor), or `/admin`
(admin). These destinations return 404 until step 4. `signOut` redirects to `/login`.
Actions invalidate the layout cache. Sign-out ends only the current session
(`scope: "local"`). Actions require cookie writes to succeed; failed persistence
cannot be reported as a successful sign-in.

### Session and routes

`apps/web/proxy.ts` delegates to the auth module. Each protected request creates
its own `@supabase/ssr` client and calls `auth.getUser()` to verify identity with
Supabase Auth. The SDK refreshes expired sessions when a valid refresh token is
available.

Updated cookies reach both the forwarded request and the browser response.
Cookie deletions and cache prevention headers are preserved, including on
redirects. A missing or invalid session, or failed verification, redirects to
`/login`. Redirects after POST use HTTP 303 to avoid replaying the submitted body.
`/login` also refreshes existing cookies while remaining accessible without a
session or when Supabase is unavailable. `/health` skips this Auth check.

Only `/login` and `/health` are public routes. Asset exceptions are explicit:
`/_next/static/`, `/_next/image`, `/icons/`, `/favicon.ico`, and
`/manifest.webmanifest`. APIs and other paths containing file extensions remain
protected. Add future public assets to this scope rather than excluding all
paths with an extension.

`/login` returns the form with HTTP 200. The proxy verifies the Auth session;
the profile check described above runs at sign-in. Future role pages and business
operations must also enforce authorization on the server, with RLS protecting data
access: a sign-in redirect is not an authorization rule for later operations.

## References

- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
- [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Next.js Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
