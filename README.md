# Chantier

App iPhone (web app installable) pour suivre à deux les travaux de la maison.

- **Chantiers** : chaque chantier est un processus en étapes ordonnées (décider, acheter, tester, préparer, appliquer…). Une étape est franchie quand ses tâches sont faites ; la suivante attend. Une tâche d'achat se coche seule quand ses articles sont achetés.
- **Aujourd'hui** : avancement, série de semaines, « on a combien de temps ? » qui choisit quoi faire, petites victoires, décisions qui bloquent, fil d'activité.
- **Pièces** : avancement par pièce avec photos avant/après, et recherche dans toutes les tâches.
- **Dicter** : on parle en vrac, Claude propose des tâches, coche ce qui est fait, ajoute les courses.
- **Sessions** (depuis l'accueil) : on fixe un créneau à deux, l'app le remplit.
- **Courses** : regroupées par magasin, reliées aux tâches.

Mise en place : voir [SETUP.md](SETUP.md). Sans configuration, l'app tourne en mode démo.

Structure : `web/` (l'app, sans étape de build), `supabase/` (schéma, seed, fonction de dictée), `scripts/` (génération de la liste initiale), `data/backlog.json` (liste initiale).
