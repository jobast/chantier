"""Génère data/backlog.json (v3) : tâches multi-pièces, durées, courses, options de décision.
Source unique du seed : l'app démo (web/seed.json) et supabase/seed.sql en dérivent."""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROOMS = [
    ("maison", "Toute la maison"), ("ch-liam", "Chambre Liam"), ("ch-maceo", "Chambre Maceo"),
    ("ch-solal", "Chambre Solal"), ("ch-parents", "Notre chambre"), ("ch-malik", "Chambre Malik"),
    ("bureau", "Bureau"), ("sdb-parents", "Notre salle de bain"), ("sdb-enfants", "SDB enfants + Malik"),
    ("salon", "Salon / cuisine"), ("couloirs", "Couloirs"), ("toit", "Toit"), ("aile", "Autre aile"),
]
KIDS = ["ch-liam", "ch-maceo", "ch-solal"]
tasks, options, shopping = [], [], []

def t(id, title, rooms, lot, minutes, kind="travaux", prio="normale", deps=(), note=""):
    tasks.append(dict(id=id, title=title, rooms=list(rooms), lot=lot, kind=kind, priority=prio,
                      minutes=minutes, depends_on=list(deps), note=note))

def opt(task, *labels):
    for i, l in enumerate(labels):
        options.append(dict(id=f"{task}-o{i+1}", task_id=task, label=l))

def buy(id, label, qty="", store="", task=None):
    shopping.append(dict(id=id, label=label, qty=qty, store=store, task_id=task))

# --- Décisions et R&D transverses
t("enduit-rd", "Enduit chaux : se documenter sur les recettes et dosages", ["maison"], "Enduit chaux", 120, "test", "haute",
  note="Une seule recherche pour toute la maison (chambres, bureau, salon).")
t("enduit-essais", "Enduit chaux : faire des essais sur panneaux", ["maison"], "Enduit chaux", 240, "test", "haute", ["enduit-rd"],
  note="Noter chaque essai dans le carnet : recette, photo, verdict.")
t("lum-dec", "Éclairage : spots encastrés ou abat-jour ?", ["maison"], "Électricité & lumières", 60, "decision", "haute",
  note="Bloque les saignées, donc l'enduit.")
opt("lum-dec", "Spots encastrés", "Abat-jour / suspensions", "Mixte selon les pièces")
t("termites-dec", "Termites : choisir le produit et la méthode", ["maison"], "Termites", 60, "decision", "haute",
  note="A faire avant toute peinture ou vernis sur le bois.")
t("turquoise-dec", "Choisir le turquoise (teinte, type de peinture)", ["maison"], "Portes & fenêtres", 45, "decision")
t("rideaux-dec", "Choisir les rideaux", ["maison"], "Rideaux", 60, "decision")
t("ventilo-dec", "Trouver la technique pour poser des ventilateurs", ["maison"], "Ventilation", 90, "decision")
t("solaire", "Isoler le bruit du solaire : fermer le petit réduit", ["maison"], "Bruit solaire", 240, prio="urgente")
t("wc-visiteurs", "Fermer les toilettes visiteurs (monter un mur)", ["maison"], "Bruit solaire", 480, prio="haute")
t("porte-entree", "Régler la porte d'entrée", ["maison"], "Portes & fenêtres", 60)
t("penderie", "Faire le(s) meuble(s) de penderie", ["maison"], "Mobilier", 960)

# --- Travaux répétés : une tâche, une case par pièce
t("termites", "Traitement termites", KIDS + ["bureau", "sdb-parents", "sdb-enfants", "salon"], "Termites", 60, prio="haute",
  deps=["termites-dec"], note="Salon : la fenêtre.")
t("toit", "Traiter le haut du toit (termites)", ["toit"], "Termites", 240, prio="haute", deps=["termites-dec"])
t("saignees", "Saigner les murs et passer les fils", KIDS + ["bureau"], "Électricité & lumières", 240, deps=["lum-dec"],
  note="Avant l'enduit, sinon on casse l'enduit neuf.")
t("plafonds", "Peindre le plafond", KIDS + ["bureau"], "Peinture", 240)
t("boiseries", "Peindre les boiseries", KIDS + ["bureau"], "Peinture", 180, deps=["termites"])
t("enduit", "Appliquer l'enduit chaux", KIDS + ["bureau"], "Enduit chaux", 480, deps=["enduit-essais", "saignees", "plafonds"])
t("fenetres-turq", "Peindre les fenêtres en turquoise", KIDS, "Portes & fenêtres", 240, deps=["turquoise-dec", "termites"])
t("portes-vernis", "Vernir la porte", KIDS, "Portes & fenêtres", 120, deps=["termites"])
t("plinthes", "Tester une peinture sur les plinthes", ["ch-liam"], "Peinture", 60, "test",
  note="Un essai dans une chambre, puis on généralise si c'est bien.")
t("lumieres", "Installer les lumières", KIDS + ["ch-parents", "bureau", "sdb-parents", "sdb-enfants"], "Électricité & lumières", 120,
  deps=["lum-dec"])
t("balais", "Poser un balai de bas de porte (serpents)", KIDS + ["ch-parents", "ch-malik", "bureau"], "Anti-serpents", 20, prio="haute")
t("rideaux", "Poser les rideaux", KIDS + ["ch-parents", "ch-malik", "bureau"], "Rideaux", 45, deps=["rideaux-dec"])
t("sdb-peinture", "Peindre la salle de bain", ["sdb-parents", "sdb-enfants"], "Peinture", 360)
t("sdb-finition", "Carrelage ou autre finition : décider", ["sdb-parents", "sdb-enfants"], "Finitions", 60, "decision")

# --- Notre chambre
t("porte-bureau", "Condamner la porte entre notre chambre et le bureau", ["ch-parents"], "Portes & fenêtres", 240,
  note="Une seule opération pour les deux pièces.")
t("porte-chambre", "Réparer la porte de la chambre qui ne ferme pas", ["ch-parents"], "Portes & fenêtres", 90,
  note="Dictée : 'porte d'entrée'. Compris comme la porte de la chambre, à confirmer.")
t("dessus-porte", "Fermer l'ouverture au-dessus de la porte", ["ch-parents"], "Portes & fenêtres", 180)
t("boiseries-dec", "Boiseries : les exploiter ou les fondre dans le mur ?", ["ch-parents"], "Boiseries", 30, "decision")
opt("boiseries-dec", "Les exploiter pour suspendre des choses", "Les peindre couleur mur pour les fondre")
t("boiseries-parents", "Boiseries : réaliser l'option choisie", ["ch-parents"], "Boiseries", 240, deps=["boiseries-dec", "termites-dec"])
t("pf-parents", "Peindre les portes-fenêtres", ["ch-parents"], "Portes & fenêtres", 240)

# --- Chambre Malik
t("malik-fenetres", "Faire les fenêtres", ["ch-malik"], "Portes & fenêtres", 240)
t("malik-peinture", "Peindre la chambre", ["ch-malik"], "Peinture", 480)
t("malik-porte", "Finir de peindre la porte en turquoise", ["ch-malik"], "Portes & fenêtres", 60, deps=["turquoise-dec"])
t("malik-ventilo", "Installer un ventilateur", ["ch-malik"], "Ventilation", 120, deps=["ventilo-dec"],
  note="Ajoute les autres pièces qui en ont besoin.")

# --- Bureau
t("bureau-rangement", "Ranger le bureau et virer le bazar", ["bureau"], "Rangement", 240, prio="haute",
  note="Débloque tout le reste de la pièce.")
t("bureau-poutres", "Combler les trous en haut des murs (poutres) : planches ou autre", ["bureau"], "Boiseries", 480)
t("bureau-portes", "Peindre la porte et la porte-fenêtre", ["bureau"], "Portes & fenêtres", 180)
t("bureau-fenetre", "Réparer la fenêtre cassée", ["bureau"], "Portes & fenêtres", 120, prio="haute")

# --- Salles de bain
t("sdb-vitre", "Poser une vitre sur la fenêtre", ["sdb-parents"], "Portes & fenêtres", 60, prio="haute")
t("sdb-eau", "Évacuation d'eau : stagne et déborde", ["sdb-enfants"], "Plomberie", 240, prio="urgente",
  note="Risque de dégâts des eaux : avant toute finition.")

# --- Salon / cuisine
t("chaux-prep", "Préparer la chaux (éteindre, laisser reposer)", ["salon"], "Enduit chaux", 120,
  note="Chaux vive = caustique : lunettes et gants.")
t("chaux-reprise", "Reprendre la chaux aux endroits cassés", ["salon"], "Enduit chaux", 240, deps=["chaux-prep"])
t("dalles", "Couvrir les tranches de dalles en ciment apparent", ["salon"], "Finitions", 480)
t("poteaux-dec", "Poteaux : peindre ou habiller ?", ["salon"], "Finitions", 30, "decision")
opt("poteaux-dec", "Peindre", "Habiller (bois, corde, enduit…)")
t("poteaux", "Poteaux : réaliser l'option choisie", ["salon"], "Finitions", 480, deps=["poteaux-dec"])
t("plancher-buanderie", "Plancher au-dessus de la buanderie", ["salon"], "Structure", 960)
t("tiroir", "Séparateurs dans le tiroir à couverts", ["salon"], "Mobilier", 15, prio="basse")
t("appliques-bar", "Appliques au-dessus du bar", ["salon"], "Électricité & lumières", 120, deps=["lum-dec"])
t("lumieres-salon", "Replacer toutes les lumières", ["salon"], "Électricité & lumières", 180, deps=["lum-dec"])
t("sous-escalier", "Meubles sous l'escalier", ["salon"], "Mobilier", 960)
t("appliques-couloirs", "Poser des appliques", ["couloirs"], "Électricité & lumières", 180, deps=["lum-dec"])

# --- Autre aile
t("aile-dec", "Autre aile : escalier ou appartement indépendant ?", ["aile"], "Autre aile", 60, "decision", "haute",
  note="Préférence : appartement. Mais un escalier depuis le salon réduit l'indépendance.")
opt("aile-dec", "Escalier depuis la maison", "Appartement indépendant")
t("aile-mur", "Monter le mur de séparation", ["aile"], "Autre aile", 960, deps=["aile-dec"])
t("aile-terrasse", "Ouvrir derrière : terrasse et porte-fenêtre", ["aile"], "Autre aile", 1920, deps=["aile-dec"])
t("aile-escalier", "Escalier : extérieur ou depuis le salon ?", ["aile"], "Autre aile", 60, "decision", deps=["aile-dec"])
opt("aile-escalier", "Escalier extérieur", "Escalier depuis le salon")

# --- Courses
buy("c-chaux", "Chaux aérienne", "1 sac", "Matériaux", "enduit-essais")
buy("c-sable", "Sable fin", "1 sac", "Matériaux", "enduit-essais")
buy("c-panneaux", "Panneaux pour les essais d'enduit", "3-4", "Bricolage", "enduit-essais")
buy("c-balais", "Balais de bas de porte", "6", "Bricolage", "balais")
buy("c-tiroir", "Séparateurs de tiroir à couverts", "1", "", "tiroir")
buy("c-vitre", "Vitre sur mesure (mesurer avant)", "1", "Vitrier", "sdb-vitre")

ids = {x["id"] for x in tasks}
for x in tasks:
    assert all(d in ids for d in x["depends_on"]), x["id"]
data = dict(version=3, members=["Joan", "Jacqueline"],
            rooms=[dict(id=a, name=b, sort=i) for i, (a, b) in enumerate(ROOMS)],
            tasks=tasks, options=options, shopping=shopping)
(ROOT / "data/backlog.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
print(len(tasks), "tâches,", sum(len(x["rooms"]) for x in tasks), "cases pièce,", len(shopping), "courses")
