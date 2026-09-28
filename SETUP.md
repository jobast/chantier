# Mise en place

L'app tourne tout de suite en **mode démo** : les données restent dans le navigateur du téléphone.
Pour la partager avec Jacqueline, il faut une base commune (Supabase, gratuit) et, pour la dictée intelligente, une clé Claude (payante à l'usage).
Compter 30 à 45 minutes, une seule fois.

## 1. Mettre l'app en ligne (GitHub Pages)

1. Sur GitHub : *Settings → Pages → Build and deployment → Source : GitHub Actions*.
2. Onglet *Actions* : lancer « Publier l'app » (ou pousser un commit dans `web/`).
3. L'adresse s'affiche dans le job, du type `https://jobast.github.io/chantier/`.

À ce stade, l'app marche en mode démo.

## 2. Créer la base (Supabase)

1. Créer un compte et un projet sur https://supabase.com (offre gratuite, région Europe).
2. *SQL Editor* → coller et exécuter `supabase/migrations/001_init.sql`.
3. Toujours dans *SQL Editor*, déclarer le foyer (mettre les vrais e-mails) :
   ```sql
   insert into members (email, name) values
     ('email-de-joan@exemple.fr', 'Joan'),
     ('email-de-jacqueline@exemple.fr', 'Jacqueline');
   ```
   Les noms doivent rester `Joan` et `Jacqueline` : l'app s'en sert pour « qui s'en occupe ».
4. Exécuter `supabase/seed.sql` : les pièces, 21 chantiers découpés en étapes (90 tâches), les options de décision et les premières courses.

### Connexion par code (important sur iPhone)

Sur iPhone, un lien magique ouvre Safari, pas l'app posée sur l'écran d'accueil : la connexion serait perdue.
L'app utilise donc un **code à 6 chiffres**.

*Authentication → Email Templates → Magic Link* : remplacer le contenu par
```html
<h2>Code Chantier</h2>
<p>Ton code : <strong>{{ .Token }}</strong></p>
```
*Authentication → URL Configuration* : mettre l'adresse GitHub Pages dans *Site URL*.

## 3. Brancher l'app sur la base

*Project Settings → API* : copier *Project URL* et la clé *anon public* dans `web/js/config.js`, puis commit et push.
La clé *anon* est faite pour être publique : les règles de la base (RLS) n'autorisent que les e-mails de la table `members`.
Ne jamais mettre la clé *service_role* dans l'app.

## 4. La dictée intelligente (facultatif mais c'est le meilleur de l'app)

1. Créer une clé sur https://console.anthropic.com et y mettre quelques euros de crédit.
   Ordre de grandeur (estimation) : quelques centimes par dictée.
2. Depuis un ordinateur, dans ce dépôt :
   ```sh
   npx supabase login
   npx supabase link --project-ref <ref du projet>
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   npx supabase functions deploy dictee
   ```
Sans cette étape, tout le reste marche ; seule la dictée affiche une erreur.

## 5. Sur les iPhones

Ouvrir l'adresse dans **Safari** → bouton Partager → **Sur l'écran d'accueil**.
Lancer l'app depuis l'icône, entrer son e-mail, puis le code reçu.

## Modifier la liste de départ

`scripts/gen_backlog.py` contient la liste initiale. Après modification :
```sh
python3 scripts/gen_backlog.py && python3 scripts/gen_seed.py
```
Cela régénère `supabase/seed.sql` et `web/seed.json` (démo). Une fois la base remplie, on modifie plutôt depuis l'app.
