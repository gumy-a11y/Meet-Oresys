# Meet'Oresys

Carte des salles de séminaire (60 à 90 personnes) à Paris et en proche banlieue, avec le temps de trajet depuis Oresys (48 rue de Londres).

Chaque lieu a deux notes :

- **Avis Oresys** : la note et le commentaire des consultants qui connaissent la salle. Plusieurs avis possibles par lieu (un par visite ou par événement).
- **Note Google** : la note publique du lieu sur Google Maps, avec le nombre d'avis et la date à laquelle elle a été relevée.

Qui voit quoi :

- **Sans compte** : la carte, les fiches et la note Google.
- **Avec un compte @oresys.eu** : en plus, les avis Oresys, les statuts (à visiter, visité, retenu, écarté) et les photos. On peut aussi ajouter et modifier des lieux et mettre à jour la note Google.

Le site est statique (HTML, CSS, JavaScript, sans étape de build). Les données sont dans Supabase.

## Comptes

L'inscription se fait par e-mail et mot de passe, **sans e-mail de validation** : le compte fonctionne immédiatement. Seules les adresses du domaine Oresys peuvent créer un compte, et la base de données refuse les autres.

Comme les adresses ne sont pas vérifiées, quelqu'un qui connaît le site pourrait s'inscrire avec une adresse @oresys.eu inventée. C'est acceptable pour tester le concept. Les sécurités possibles ensuite : réactiver la validation par e-mail, ou passer par une connexion Microsoft 365.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html` | La page |
| `style.css` | La mise en forme |
| `app.js` | Carte, filtres, fiches, comptes, avis, note Google, ajout de lieux |
| `config.js` | Adresse et clé Supabase, domaine autorisé, point de départ des trajets |
| `supabase/schema.sql` | Tables, règles d'accès, stockage des photos et les 42 lieux de départ |

## Mise en place

### 1. Créer la base Supabase

1. Sur [supabase.com](https://supabase.com), créez un projet (région Europe).
2. Si votre domaine e-mail n'est pas `oresys.eu`, remplacez-le dans `supabase/schema.sql` (4 occurrences) et dans `config.js`.
3. Dans **SQL Editor > New query**, collez tout `supabase/schema.sql` et cliquez sur **Run**. Les 42 lieux sont créés, dont 12 espaces de travail premium (Wojo, Keeze, Morning, O65, Kwerk).
4. **Désactivez l'e-mail de validation** : **Authentication > Sign In / Providers > Email**, décochez **Confirm email**, puis enregistrez.
5. Dans **Project Settings > API**, copiez la **Project URL** et la clé **anon public**.

### 2. Renseigner `config.js`

Remplacez `SUPABASE_URL` et `SUPABASE_ANON_KEY` par les valeurs copiées.

La clé anon peut être publiée dans le dépôt : ce sont les règles du SQL qui protègent les données. Ne mettez jamais la clé `service_role` dans ce fichier.

### 3. Publier sur GitHub puis Vercel

```bash
git init
git add .
git commit -m "Meet'Oresys"
git branch -M main
git remote add origin https://github.com/<votre-compte>/meet-oresys.git
git push -u origin main
```

Sur [vercel.com](https://vercel.com) : **Add New > Project**, importez le dépôt. Framework : **Other**, pas de commande de build, dossier de sortie : la racine. Cliquez sur **Deploy**.

### 4. Indiquer l'adresse du site à Supabase

**Authentication > URL Configuration > Site URL** : l'adresse Vercel, par exemple `https://meet-oresys.vercel.app`.

### 5. Créer votre compte

Ouvrez le site, onglet **Créer un compte**, avec votre adresse Oresys.

## Renseigner la note Google

Les notes Google ne sont pas encore remplies. Sur chaque fiche :

1. Cliquez sur **Voir sur Google Maps** : la fiche du lieu s'ouvre.
2. Revenez sur Meet'Oresys et cliquez sur **Renseigner la note**.
3. Saisissez la note (par exemple 4,5) et le nombre d'avis. Collez le lien de la fiche Google si vous voulez que le bouton y mène directement.

La date de relevé est enregistrée automatiquement. Il suffit de cliquer sur **Mettre à jour** de temps en temps.

Pour une mise à jour automatique, il faudrait l'API Google Places : une clé Google Cloud avec facturation, et une petite fonction côté serveur (Supabase Edge Function).

## Ajouter ou modifier un lieu

Avec un compte Oresys :

1. Cliquez sur **+ Ajouter un lieu**.
2. Saisissez le nom, puis l'adresse, et cliquez sur **Localiser**. Si l'adresse n'est pas trouvée, cliquez sur la carte.
3. Ajustez le repère orange en le faisant glisser si besoin.
4. Un temps de trajet est proposé à partir de la distance : corrigez-le avec l'itinéraire réel.
5. Complétez les autres champs, dont la note Google, puis enregistrez.

Le lien **Modifier** d'une fiche ouvre le même formulaire. Un lieu ne peut être supprimé que par la personne qui l'a ajouté, et la suppression efface aussi ses avis et photos. Les 42 lieux de départ se gèrent depuis Supabase > Table Editor > `lieux`.

## Tester en local

```bash
python3 -m http.server 8000
```

puis ouvrez <http://localhost:8000>.

## Limites

- Les temps de trajet sont des estimations porte à porte. Le bouton « Itinéraire en temps réel » donne le trajet exact.
- Capacités et tarifs des lieux de départ viennent d'annuaires de salles (1001 Salles, Privateaser, Aleou, Paris je t'aime…) : à confirmer par devis.
- La note Google est un relevé manuel, datée sur la fiche.
- Le fond de carte et la recherche d'adresse utilisent les services publics d'OpenStreetMap, adaptés à un usage interne modéré.
