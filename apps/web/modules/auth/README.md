# Authentication module

## Français

### Interface publique

| Point d'entrée                   | Usage                                                          |
| -------------------------------- | -------------------------------------------------------------- |
| `@/modules/auth`                 | `badgeNumberToEmail`, `validateSignIn` et types sérialisables. |
| `@/modules/auth/actions`         | Server Actions `signIn`, `signInFromForm` et `signOut`.        |
| `@/modules/auth/login-form`      | Composant public `LoginForm`, utilisé par `/login`.            |
| `@/modules/auth/proxy`           | Adaptateur de session `updateSession` pour le proxy Next.js.   |
| `@/modules/auth/server`          | Contrôles serveur `requireProfile` et `redirectToRoleHome`.    |
| `@/modules/auth/role-home`       | Page temporaire serveur `RoleHome`, protégée par rôle.         |
| `@/modules/auth/page-loading`    | État d'attente bilingue `AuthPageLoading`.                     |
| `@/modules/auth/sign-out-button` | Composant public `SignOutButton` pour l'action existante.      |

`badgeNumberToEmail("  000001  ")` retourne `000001@sentriq.local`.
Les matricules contiennent uniquement les chiffres `0–9` ; la validation refuse
les lettres, signes, décimales et autres caractères. Ils restent des chaînes de
caractères pour conserver les zéros initiaux. La normalisation retire les espaces
extérieurs et ne modifie jamais le mot de passe.
Le compte Supabase Auth doit déjà exister avec cet email synthétique : ces actions
ne créent ni compte ni profil.

Les actions renvoient une erreur générique `{ success: false, code, message }`
avec `message.fr` et `message.en` en cas d'échec. Elles ne renvoient aucun jeton
ni erreur brute Supabase. Zod valide les champs non vides côté serveur et fournit
des erreurs de champ FR/EN sans renvoyer le mot de passe. Le formulaire reprend
l'affichage simultané FR puis EN, avec `lang="en"` sur les traductions.
Les identifiants refusés produisent toujours « Matricule ou mot de passe invalide. ».

Après authentification, `signIn` lit `role,is_active` dans `public.profiles` pour
l'identifiant Auth vérifié, via le client utilisateur et les politiques RLS.
Un profil absent ou inactif entraîne une déconnexion immédiate et le message
« Compte désactivé, contactez votre superviseur. ». Une erreur de lecture ou un
rôle inconnu bloque également la connexion avec une erreur d'indisponibilité.
Les nouveaux cookies de session restent différés jusqu'à validation du profil ;
ils sont supprimés en cas de refus, même si la révocation distante échoue.

Un profil actif redirige vers `/agent` (agent), `/dispatch` (supervisor) ou `/admin`
(admin). Ces pages protégées affichent temporairement le nom, le rôle et la
déconnexion en français et en anglais ; le matricule remplace un nom absent.
`SignOutButton` utilise l'action existante et affiche aussi les états d'attente
et les erreurs dans les deux langues. `signOut` redirige vers `/login`.
Les actions invalident le cache des layouts et la déconnexion est
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
les pages par rôle vérifient aussi le profil actif côté serveur à chaque accès.
Elles utilisent l'interface publique `@/modules/auth/role-home`, qui applique le
contrôle de `@/modules/auth/server` avant d'afficher les données utilisateur.
`requireProfile(expectedRole?)` appelle `auth.getUser()` auprès de Supabase Auth,
puis lit le propre profil de cet utilisateur avec le client utilisateur soumis
aux politiques RLS. Sans rôle attendu, il vérifie seulement l'identité et le profil
actif. Avec un rôle attendu, il exige une correspondance exacte : un agent va sur
`/agent`, un supervisor sur `/dispatch` et un admin sur `/admin`. Tout autre rôle
valide est redirigé vers sa propre page ; le rôle admin n'implique aucun accès
automatique aux deux autres pages.

Une identité invalide, un profil absent, inactif ou mal formé, ou une erreur de
vérification redirige vers `/login` sans afficher les données du profil. Ce
contrôle dans un Server Component ne modifie pas les cookies du navigateur ;
seuls les actions et l'adaptateur de session du proxy les modifient. L'identité
et le profil ne sont jamais mis en cache entre les requêtes.

L'accueil `/` appelle `redirectToRoleHome()` pour appliquer le même contrôle et
rediriger vers la page du rôle. Les futurs modules doivent utiliser cette interface
publique pour les contrôles de page, puis vérifier les autorisations propres à
leurs opérations côté serveur et conserver RLS au niveau des données.

Avec Cache Components, les contrôles liés à la requête sont placés dans `Suspense`
avec l'attente bilingue `AuthPageLoading`. Une redirection peut être un HTTP 307
ou, si l'enveloppe HTML est déjà envoyée, un HTTP 200 contenant la redirection
streamée de Next.js (`meta` refresh). Le contrôle reste côté serveur et aucune
donnée de profil n'est rendue avant son succès. Les redirections des Server
Actions après connexion ou déconnexion utilisent HTTP 303.

## English

### Public interface

| Entry point                      | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `@/modules/auth`                 | `badgeNumberToEmail`, `validateSignIn`, and serializable types. |
| `@/modules/auth/actions`         | `signIn`, `signInFromForm`, and `signOut` Server Actions.       |
| `@/modules/auth/login-form`      | Public `LoginForm` component, used by `/login`.                 |
| `@/modules/auth/proxy`           | `updateSession` session adapter for the Next.js proxy.          |
| `@/modules/auth/server`          | `requireProfile` and `redirectToRoleHome` server authorization. |
| `@/modules/auth/role-home`       | Server-rendered `RoleHome` placeholder with a role guard.       |
| `@/modules/auth/page-loading`    | Bilingual `AuthPageLoading` pending state.                      |
| `@/modules/auth/sign-out-button` | Public `SignOutButton` for the existing action.                 |

`badgeNumberToEmail("  000001  ")` returns `000001@sentriq.local`.
Badge numbers contain only digits `0–9`; validation rejects letters, signs,
decimals, and other characters. They remain strings to preserve leading zeros.
Normalization trims surrounding whitespace and never changes the password.
The Supabase Auth account must already exist with that synthetic email: these
actions create neither accounts nor profiles.

On failure, actions return a generic `{ success: false, code, message }` error
with `message.fr` and `message.en`. They return no tokens or raw Supabase errors.
Zod validates nonempty fields on the server and returns bilingual field errors,
never the password. The form presents French followed by English simultaneously,
marking translations with `lang="en"`. Rejected credentials
always produce “Invalid badge number or password.”.

After authentication, `signIn` reads `role,is_active` from `public.profiles` for the
verified Auth user ID, using the user's client and RLS policies. A missing or
inactive profile immediately signs out with “Account disabled. Contact your
supervisor.”. Profile query failures and unknown roles also block sign-in with
an unavailable-service message. New session cookies are deferred until the profile
is approved; rejection clears them even if remote revocation fails.

An active profile redirects to `/agent` (agent), `/dispatch` (supervisor), or `/admin`
(admin). These protected pages temporarily display the name, role, and sign-out
action in French and English; the badge number replaces a missing name.
`SignOutButton` calls the existing action and also displays pending states and
errors in both languages. `signOut` redirects to `/login`. Actions invalidate
the layout cache. Sign-out ends only the current session
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
role pages also verify the active profile on the server on every access.
They use the public `@/modules/auth/role-home` interface, which applies the
`@/modules/auth/server` guard before rendering user data.
`requireProfile(expectedRole?)` calls `auth.getUser()` against Supabase Auth, then
reads that user's own profile through the user client and RLS policies. Without an
expected role, it verifies identity and the active profile. With an expected role,
it requires an exact match: agents use `/agent`, supervisors use `/dispatch`, and
admins use `/admin`. Any other valid role redirects to its own page; the admin
role does not automatically grant access to the other two pages.

An invalid identity, missing, inactive, or malformed profile, or verification
failure redirects to `/login` without rendering profile data. This Server
Component guard does not mutate browser cookies; actions and the proxy remain
the only browser session cookie writers. Identity and profile state are never
cached across requests.

The `/` home route calls `redirectToRoleHome()` to apply the same checks and
redirect to the role's page. Future modules must use this public interface for
page checks, enforce their own operation-specific authorization on the server,
and retain RLS protection for data access.

With Cache Components, request-bound checks run inside `Suspense` with the
bilingual `AuthPageLoading` fallback. A redirect can use HTTP 307 or, if the HTML
shell has already been sent, HTTP 200 with a Next.js streamed redirect (`meta`
refresh). Authorization still runs on the server, and no profile data renders
before it succeeds. Server Action redirects after sign-in or sign-out use HTTP 303.

## References

- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
- [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Next.js Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
