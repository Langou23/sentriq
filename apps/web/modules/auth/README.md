# Authentication module

## Français

### Interface publique

| Point d'entrée           | Usage                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `@/modules/auth`         | `badgeNumberToEmail` et types d'erreurs sérialisables.         |
| `@/modules/auth/actions` | Server Actions `signIn(badgeNumber, password)` et `signOut()`. |
| `@/modules/auth/proxy`   | Adaptateur de session `updateSession` pour le proxy Next.js.   |

`badgeNumberToEmail("  ab-001  ")` retourne `AB-001@sentriq.local`.
La normalisation conserve les zéros initiaux et ne modifie jamais le mot de passe.
Le compte Supabase Auth doit déjà exister avec cet email synthétique : ces actions
ne créent ni compte ni profil.

Les actions renvoient une erreur générique `{ success: false, code, message }`
avec `message.fr` et `message.en` en cas d'échec. Elles ne renvoient aucun jeton
ni erreur brute Supabase. Après succès, `signIn` redirige vers `/` et `signOut`
vers `/login`, en invalidant le cache des layouts. La déconnexion est limitée à
la session courante (`scope: "local"`). Les actions exigent l'écriture effective
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

Aucune page de connexion n'est créée à cette étape : `/login` retourne donc
encore une page 404, sans boucle de redirection. Le proxy vérifie la session
Auth ; les autorisations par rôle et `is_active` restent à traiter dans les
flux applicatifs, avec RLS au niveau des données.

## English

### Public interface

| Entry point              | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `@/modules/auth`         | `badgeNumberToEmail` and serializable error types.              |
| `@/modules/auth/actions` | `signIn(badgeNumber, password)` and `signOut()` Server Actions. |
| `@/modules/auth/proxy`   | `updateSession` session adapter for the Next.js proxy.          |

`badgeNumberToEmail("  ab-001  ")` returns `AB-001@sentriq.local`.
Normalization preserves leading zeros and never changes the password.
The Supabase Auth account must already exist with that synthetic email: these
actions create neither accounts nor profiles.

On failure, actions return a generic `{ success: false, code, message }` error
with `message.fr` and `message.en`. They return no tokens or raw Supabase errors.
After success, `signIn` redirects to `/` and `signOut` to `/login`, invalidating
the layout cache. Sign-out ends only the current session (`scope: "local"`).
Actions require cookie writes to succeed; failed persistence cannot be reported
as a successful sign-in.

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

No login page is created at this stage, so `/login` still returns a 404 page,
without a redirect loop. The proxy verifies the Auth session; role and
`is_active` authorization remain to be handled in application flows, with RLS
protecting data access.

## References

- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
- [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Next.js Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
