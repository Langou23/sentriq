# Timekeeping module

## Français

### Interface publique

| Point d’entrée                     | Usage                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `@/modules/timekeeping`            | Types sérialisables de l’espace agent, des sites, des sessions et des résultats. |
| `@/modules/timekeeping/actions`    | Server Actions `checkIn(input)` et `checkOut(input)`.                            |
| `@/modules/timekeeping/server`     | Lecture protégée `getAgentWorkspace()` pour la page agent.                       |
| `@/modules/timekeeping/agent-home` | Composant serveur public `AgentHome` utilisé par `/agent`.                       |

Les autres modules utilisent uniquement ces interfaces. `repository.ts`,
`validation.ts`, `geo.ts` et `errors.ts` restent internes au module.

Chaque action et chaque lecture de l’espace agent commence par
`requireProfile("agent")`, l’interface serveur publique du module auth.
L’utilisateur doit posséder un profil actif de rôle `agent`. Les redirections
d’authentification se propagent normalement, avant tout accès aux données de
pointage. Les opérations utilisent le client Supabase de l’utilisateur et RLS,
sans clé privilégiée ni état partagé entre requêtes.

### Contrats des actions

`checkIn` accepte exactement `{ siteId, latitude, longitude }` ; `checkOut`
accepte exactement `{ sessionId, latitude, longitude }`. Zod valide les UUID et
les coordonnées numériques finies dans les plages géographiques admises. Tout
champ supplémentaire est refusé : l’identité de l’agent, les horaires, le rayon,
les distances et le résultat du périmètre ne sont jamais fournis par le client.

Le serveur lit les coordonnées et le rayon du site dans Supabase et calcule la
distance avec la formule de Haversine. La comparaison au rayon utilise la
distance réelle ; seule la distance enregistrée est arrondie au mètre. Un pointage
hors périmètre est accepté et conserve un indicateur `withinRadius: false` dans
le résultat de mesure, exposé comme `checkInWithinRadius` ou
`checkOutWithinRadius` dans la session.

Ce calcul est garanti sur le parcours des Server Actions. Les coordonnées GPS
restent déclarées par le navigateur, sans attestation de position physique.
Les droits directs sur les tables restent ceux des migrations : RLS contrôle
l’accès aux lignes, mais ne recalcule pas la géométrie des écritures REST directes.

Pour commencer un poste, le site et l’affectation de l’agent doivent être actifs.
L’action vérifie qu’aucune session n’est ouverte, puis PostgreSQL garantit aussi
cette règle sous concurrence avec l’index unique
`work_sessions_one_open_per_agent`. Une violation `23505` devient l’erreur métier
`already_open`. L’INSERT contient uniquement l’agent vérifié, le site et les
métadonnées de localisation d’arrivée : l’identifiant, l’heure d’arrivée et les
horodatages d’audit proviennent des valeurs par défaut de la base.

Pour terminer un poste, le serveur charge la session appartenant à l’agent et le
site enregistré sur cette session. L’affectation et le site peuvent avoir été
désactivés depuis l’arrivée. Les politiques de lecture doivent permettre à
l’agent de lire le site de sa propre session ouverte, même inactif. L’UPDATE ne
modifie que l’heure UTC serveur et les métadonnées de départ et filtre encore
par identifiant, propriétaire et `check_out_at IS NULL`. Si une requête concurrente
a déjà terminé la session, l’action renvoie `session_closed` ; une session fermée
ne peut pas être modifiée.

En cas de succès, les actions invalident `/agent` et renvoient
`{ success: true, operation: "check_in" | "check_out", session }`.
La session inclut le résumé du site et les informations de périmètre. En cas
d’échec, elles renvoient `{ success: false, code, message: { fr, en } }`, sans
erreur brute Supabase ni donnée d’authentification. Les écritures de cookies de
session doivent réussir dans les actions.

### Espace agent

`getAgentWorkspace()` renvoie le profil vérifié et un résultat localisé. Le
résultat réussi contient les sites actifs d’affectations actives, dédupliqués,
la session ouverte éventuelle, la dernière session terminée et `serverNow` en
UTC. Les coordonnées du site ne font pas partie du résumé transmis au navigateur.

Une session ouverte exige un site lisible et valide, même si ce site n’est plus
actif ou affecté. Le résumé d’un ancien site peut être `null` dans une session
terminée lorsque RLS ne permet plus sa lecture. Une erreur de requête ou de
validation d’une réponse provoque `service_unavailable`, jamais un faux état
« aucune affectation ». Les réponses Supabase sont validées à l’exécution avant
leur conversion en contrats publics.

### Interface agent

`/agent` affiche les sites actifs affectés à l’agent, avec leur nom et leur adresse.
Un seul site est sélectionné automatiquement ; plusieurs sites demandent un choix.
Une absence d’affectation et une erreur de lecture ont des messages distincts.
Une session ouverte affiche son site, son début à l’heure du Québec et sa durée
écoulée. Les traductions anglaises suivent les libellés français.

Le navigateur demande une position ponctuelle uniquement au clic sur une action,
avec haute précision, un délai maximal de 15 secondes et aucun cache de position.
Un verrou empêche les doubles clics pendant la localisation, l’écriture et
l’actualisation. Les refus, indisponibilités et dépassements de délai de
localisation disposent de messages FR/EN. Le badge « Signalé / Flagged » indique
une entrée ou une sortie hors périmètre, y compris après un rechargement pour la
dernière session terminée.

Avant de tester sur Supabase hébergé, appliquer aussi
[`20261024020330_allow_open_session_site_read.sql`](../../../../supabase/migrations/20261024020330_allow_open_session_site_read.sql).
Cette migration permet uniquement à un agent actif de lire le site de sa propre
session ouverte lorsqu’il a été désactivé, afin de calculer la distance de sortie.
Les sessions fermées et les autres sites inactifs ne donnent pas cet accès.

## English

### Public interface

| Entry point                        | Purpose                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| `@/modules/timekeeping`            | Serializable workspace, site, session and result types.  |
| `@/modules/timekeeping/actions`    | `checkIn(input)` and `checkOut(input)` Server Actions.   |
| `@/modules/timekeeping/server`     | Protected `getAgentWorkspace()` read for the agent page. |
| `@/modules/timekeeping/agent-home` | Public `AgentHome` Server Component used by `/agent`.    |

Other modules use only these interfaces. `repository.ts`, `validation.ts`,
`geo.ts` and `errors.ts` remain internal to this module.

Each action and workspace read starts with `requireProfile("agent")`, the auth
module’s public server interface. The user must have an active profile with the
`agent` role. Authentication redirects propagate normally before any timekeeping
data access. Operations use the user’s Supabase client and RLS, with no privileged
key or state shared between requests.

### Action contracts

`checkIn` accepts exactly `{ siteId, latitude, longitude }`; `checkOut` accepts
exactly `{ sessionId, latitude, longitude }`. Zod validates UUIDs and finite
numeric coordinates within geographic ranges. Extra fields are rejected: the
client never supplies the agent identity, timestamps, radius, distances or
perimeter result.

The server reads site coordinates and radius from Supabase, then calculates
Haversine distance. The radius comparison uses the unrounded distance; only the
stored distance is rounded to the nearest meter. Outside-perimeter timekeeping
is accepted and records `withinRadius: false`, exposed as `checkInWithinRadius`
or `checkOutWithinRadius` on the session.

These calculations are guaranteed on the Server Action path. Browser GPS
coordinates remain client-reported, without physical-location attestation.
Direct table privileges remain those defined in the migrations: RLS controls
row access but does not recalculate geometry for direct REST writes.

Starting a shift requires an active site and an active assignment for the agent.
The action checks for an open session, and PostgreSQL also enforces that rule
under concurrency with the `work_sessions_one_open_per_agent` unique index.
A `23505` violation becomes the `already_open` business error. The INSERT contains
only the verified agent, site and check-in location metadata: database defaults
own the identifier, check-in time and audit timestamps.

Ending a shift loads the agent-owned session and its stored site. The assignment
and site may have been deactivated since check-in. Read policies must let agents
read the site of their own open session even when inactive. The UPDATE changes
only the server’s UTC checkout time and checkout location metadata, filtering
again by session ID, owner and `check_out_at IS NULL`. If another request already
closed the session, the action returns `session_closed`; closed sessions cannot
be modified.

Successful actions invalidate `/agent` and return
`{ success: true, operation: "check_in" | "check_out", session }`, including the
site summary and perimeter metadata. Failures return
`{ success: false, code, message: { fr, en } }`, with no raw Supabase error or
authentication data. Session cookie writes must succeed inside actions.

### Agent workspace

`getAgentWorkspace()` returns the verified profile and a localized result.
A successful result contains deduplicated active sites from active assignments,
the optional open session, the most recent closed session and UTC `serverNow`.
Site coordinates are not included in the browser-facing site summary.

An open session requires a readable, valid site even if that site is no longer
active or assigned. A historical site summary may be `null` on a closed session
when RLS no longer allows reading it. Query or response validation failures
produce `service_unavailable`, never a misleading “no assignments” state.
Supabase responses are runtime-validated before conversion to public contracts.

### Agent interface

`/agent` lists active assigned sites with their names and addresses. One site is
selected automatically; multiple sites require a choice. Missing assignments and
query failures have separate messages. An open session shows its site, start in
Quebec time and elapsed duration. English translations follow French labels.

The browser requests a single position only on an action click, with high accuracy,
a 15-second timeout and no cached position. A synchronous lock prevents duplicate
clicks during location, persistence and refresh. Permission denial, unavailable
position and timeout have FR/EN messages. A "Signalé / Flagged" badge identifies
outside-perimeter starts or ends, including after reloading the latest closed shift.

Before testing against hosted Supabase, also apply
[`20261024020330_allow_open_session_site_read.sql`](../../../../supabase/migrations/20261024020330_allow_open_session_site_read.sql).
It lets only active agents read the site of their own open session when that site
has been deactivated, so the server can compute checkout distance. Closed sessions
and other inactive sites do not grant that access.

## References

- [Geolocation getCurrentPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)
- [Next.js Server Actions](https://nextjs.org/docs/app/getting-started/mutating-data)
