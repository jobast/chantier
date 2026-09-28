# Chantier

App iPhone (web app installable) pour suivre à deux les travaux de la maison.

- **Aujourd'hui** : avancement, série de semaines, « on a combien de temps ? » qui choisit quoi faire, petites victoires, décisions qui bloquent, fil d'activité.
- **Pièces** : avancement par pièce avec photos avant/après, vues par lot et recherche.
- **Dicter** : on parle en vrac, Claude propose des tâches, coche ce qui est fait, ajoute les courses.
- **Sessions** : on fixe un créneau à deux, l'app le remplit.
- **Courses** : regroupées par magasin, reliées aux tâches.

Mise en place : voir [SETUP.md](SETUP.md). Sans configuration, l'app tourne en mode démo.

Structure : `web/` (l'app, sans étape de build), `supabase/` (schéma, seed, fonction de dictée), `scripts/` (génération de la liste initiale), `data/backlog.json` (liste initiale).
