"""Génère data/backlog.json (v4) : des chantiers (processus) découpés en étapes, chaque étape
contenant des tâches avec une case par pièce. Source unique du seed : web/seed.json et
supabase/seed.sql en dérivent (scripts/gen_seed.py)."""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROOMS = [
    ("maison", "Toute la maison"), ("ch-liam", "Chambre Liam"), ("ch-maceo", "Chambre Maceo"),
    ("ch-solal", "Chambre Solal"), ("ch-parents", "Notre chambre"), ("ch-malik", "Chambre Malik"),
    ("bureau", "Bureau"), ("sdb-parents", "Notre salle de bain"), ("sdb-enfants", "SDB enfants + Malik"),
    ("salon", "Salon / cuisine"), ("couloirs", "Couloirs"), ("toit", "Toit"), ("aile", "Autre aile"),
]
K = ["ch-liam", "ch-maceo", "ch-solal"]
ALL_BEDROOMS = K + ["ch-parents", "ch-malik", "bureau"]

projects, stages, tasks, options, shopping = [], [], [], [], []
_cur = {}


def chantier(pid, title, prio="normale", note=""):
    projects.append(dict(id=pid, title=title, priority=prio, note=note, sort=len(projects)))
    _cur.update(pid=pid, prio=prio, n=0, stage=None)


def etape(key, title, kind):
    sid = f"{_cur['pid']}.{key}"
    stages.append(dict(id=sid, project_id=_cur["pid"], title=title, kind=kind,
                       sort=sum(1 for s in stages if s["project_id"] == _cur["pid"])))
    _cur["stage"] = sid


def t(title, rooms, minutes, kind="travaux", prio=None, deps=(), note="", key=None):
    _cur["n"] += 1
    tid = key or f"{_cur['pid']}.{_cur['n']}"
    tasks.append(dict(id=tid, title=title, rooms=list(rooms), minutes=minutes, kind=kind,
                      priority=prio or _cur["prio"], depends_on=list(deps), note=note,
                      project_id=_cur["pid"], stage_id=_cur["stage"]))
    return tid


def opt(task, *labels):
    for i, l in enumerate(labels):
        options.append(dict(id=f"{task}.o{i+1}", task_id=task, label=l))


def buy(label, qty="", store="", task=None):
    shopping.append(dict(id=f"c{len(shopping)+1}", label=label, qty=qty, store=store, task_id=task))


# ---------------------------------------------------------------- urgences
chantier("solaire", "Bruit du solaire", "urgente", "Grande urgence.")
etape("concevoir", "Décider", "decider")
t("Choisir comment fermer le réduit et le WC visiteurs", ["maison"], 60, "decision")
etape("acheter", "Acheter", "acheter")
t("Acheter les matériaux (plaques, isolant…)", ["maison"], 60, "achat")
etape("construire", "Fermer", "appliquer")
t("Fermer le petit réduit", ["maison"], 240)
t("Monter le mur des toilettes visiteurs", ["maison"], 480)

chantier("evacuation", "Évacuation de la SDB enfants", "urgente", "L'eau stagne et déborde : risque de dégâts des eaux.")
etape("diag", "Diagnostiquer", "decider")
t("Trouver pourquoi l'eau stagne", ["sdb-enfants"], 60)
etape("acheter", "Acheter", "acheter")
t("Acheter les pièces", ["sdb-enfants"], 30, "achat")
etape("reparer", "Réparer", "appliquer")
t("Réparer l'évacuation", ["sdb-enfants"], 180)
etape("verifier", "Vérifier", "finir")
t("Vérifier après une semaine d'usage", ["sdb-enfants"], 15)

chantier("serpents", "Anti-serpents : balais de porte", "haute")
etape("acheter", "Acheter", "acheter")
serp_buy = t("Acheter les balais de bas de porte", ["maison"], 30, "achat")
buy("Balais de bas de porte", "6", "Bricolage", serp_buy)
etape("poser", "Poser", "appliquer")
t("Poser un balai de bas de porte", ALL_BEDROOMS, 20)

# ---------------------------------------------------------------- processus structurants
chantier("termites", "Traitement termites", "haute", "A faire avant toute peinture ou vernis sur le bois.")
etape("choisir", "Choisir", "decider")
t("Choisir le produit et la méthode", ["maison"], 60, "decision")
etape("acheter", "Acheter", "acheter")
term_buy = t("Acheter le produit anti-termites", ["maison"], 30, "achat")
buy("Produit anti-termites", "", "", term_buy)
etape("traiter", "Traiter", "appliquer")
TERM = t("Traiter les bois", K + ["bureau", "sdb-parents", "sdb-enfants", "salon"], 60, note="Salon : la fenêtre.")
t("Traiter le haut du toit", ["toit"], 240)

chantier("eclairage", "Éclairage", "haute", "La décision bloque les saignées, donc l'enduit.")
etape("decider", "Décider", "decider")
lum = t("Spots encastrés ou abat-jour ?", ["maison"], 60, "decision")
opt(lum, "Spots encastrés", "Abat-jour / suspensions", "Mixte selon les pièces")
etape("acheter", "Acheter", "acheter")
t("Acheter luminaires, câbles et boîtiers", ["maison"], 60, "achat")
etape("saignees", "Saignées et câbles", "preparer")
SAIGN = t("Saigner les murs et passer les fils", K + ["bureau"], 240, note="Avant l'enduit, sinon on casse l'enduit neuf.")
etape("installer", "Installer", "appliquer")
t("Installer les lumières", K + ["ch-parents", "bureau", "sdb-parents", "sdb-enfants"], 120)
t("Appliques au-dessus du bar", ["salon"], 120)
t("Replacer toutes les lumières du salon", ["salon"], 180)
t("Poser des appliques", ["couloirs"], 180)

chantier("peinture", "Peinture des chambres", "normale")
etape("choisir", "Choisir", "decider")
t("Choisir peintures et couleurs", ["maison"], 60, "decision")
etape("acheter", "Acheter", "acheter")
t("Acheter la peinture", ["maison"], 60, "achat")
etape("tester", "Tester", "tester")
t("Tester une peinture sur les plinthes", ["ch-liam"], 60, "test", note="Un essai, puis on généralise si c'est bien.")
etape("plafonds", "Plafonds", "appliquer")
PLAF = t("Peindre le plafond", K + ["bureau"], 240)
etape("boiseries", "Boiseries et murs", "appliquer")
t("Peindre les boiseries", K + ["bureau"], 180, deps=[TERM])
t("Peindre la chambre", ["ch-malik"], 480)

chantier("enduit", "Enduit à la chaux", "haute", "Une seule recherche et une seule série d'essais pour toutes les pièces.")
etape("renseigner", "Se renseigner", "decider")
t("Se documenter : recettes, dosages, supports", ["maison"], 120)
etape("acheter", "Acheter", "acheter")
end_buy = t("Acheter chaux, sable et panneaux d'essai", ["maison"], 60, "achat")
buy("Chaux aérienne", "1 sac", "Matériaux", end_buy)
buy("Sable fin", "1 sac", "Matériaux", end_buy)
buy("Panneaux pour les essais", "3-4", "Bricolage", end_buy)
etape("tester", "Tester", "tester")
t("Faire des essais sur panneaux", ["maison"], 240, "test", note="Noter chaque essai dans le carnet : recette, photo, verdict.")
t("Choisir la recette", ["maison"], 30, "decision")
etape("preparer", "Préparer les murs", "preparer")
t("Préparer les murs (reboucher, humidifier)", K + ["bureau"], 120, deps=[SAIGN])
etape("appliquer", "Appliquer", "appliquer")
t("Appliquer l'enduit", K + ["bureau"], 480, deps=[PLAF])

chantier("menuiseries", "Portes et fenêtres : turquoise et vernis")
etape("choisir", "Choisir", "decider")
t("Choisir le turquoise (teinte, type de peinture)", ["maison"], 45, "decision")
etape("acheter", "Acheter", "acheter")
t("Acheter peinture turquoise et vernis", ["maison"], 30, "achat")
etape("tester", "Tester", "tester")
t("Tester la teinte sur un cadre", ["ch-liam"], 60, "test", note="Étape ajoutée : voir la teinte en vrai avant de tout peindre.")
etape("preparer", "Poncer", "preparer")
t("Poncer et préparer", K, 120, deps=[TERM])
etape("appliquer", "Peindre et vernir", "appliquer")
t("Peindre les fenêtres en turquoise", K, 240)
t("Vernir la porte", K, 120)
t("Finir la porte en turquoise", ["ch-malik"], 60)
t("Peindre les portes-fenêtres", ["ch-parents"], 240)
t("Peindre la porte et la porte-fenêtre", ["bureau"], 180)

chantier("reparations", "Réparations portes et fenêtres", "haute")
etape("mesurer", "Mesurer", "decider")
t("Mesurer et lister ce qu'il faut", ["maison"], 60)
etape("acheter", "Acheter", "acheter")
rep_buy = t("Acheter quincaillerie et vitre", ["maison"], 60, "achat")
buy("Vitre sur mesure (après mesure)", "1", "Vitrier", rep_buy)
etape("reparer", "Réparer", "appliquer")
t("Réparer la fenêtre cassée", ["bureau"], 120)
t("Poser une vitre sur la fenêtre", ["sdb-parents"], 60)
t("Réparer la porte qui ne ferme pas", ["ch-parents"], 90, note="Dictée : 'porte d'entrée'. Compris comme la porte de la chambre, à confirmer.")
t("Régler la porte d'entrée", ["maison"], 60, prio="normale")
t("Faire les fenêtres", ["ch-malik"], 240, prio="normale")
etape("fermer", "Condamner et fermer", "appliquer")
t("Condamner la porte entre notre chambre et le bureau", ["ch-parents"], 240, prio="normale")
t("Fermer l'ouverture au-dessus de la porte", ["ch-parents"], 180, prio="normale")

chantier("rideaux", "Rideaux")
etape("choisir", "Choisir", "decider")
t("Choisir les rideaux", ["maison"], 60, "decision")
etape("acheter", "Acheter", "acheter")
t("Acheter les rideaux et tringles", ["maison"], 60, "achat")
etape("poser", "Poser", "appliquer")
t("Poser les rideaux", ALL_BEDROOMS, 45)

chantier("sdb", "Salles de bain : embellir")
etape("decider", "Décider", "decider")
t("Carrelage ou autre finition ?", ["maison"], 60, "decision")
etape("acheter", "Acheter", "acheter")
t("Acheter peinture et matériaux", ["maison"], 60, "achat")
etape("peindre", "Peindre", "appliquer")
t("Peindre la salle de bain", ["sdb-parents", "sdb-enfants"], 360, deps=[TERM])
etape("finitions", "Finitions", "finir")
t("Poser la finition choisie", ["sdb-parents", "sdb-enfants"], 480)

chantier("ventilos", "Ventilateurs")
etape("technique", "Trouver la technique", "decider")
t("Trouver comment poser un ventilateur", ["maison"], 90, "decision")
etape("acheter", "Acheter", "acheter")
t("Acheter le(s) ventilateur(s)", ["maison"], 30, "achat")
etape("installer", "Installer", "appliquer")
t("Installer un ventilateur", ["ch-malik"], 120, note="Ajoute les autres pièces qui en ont besoin.")

# ---------------------------------------------------------------- salon
chantier("salon-chaux", "Salon : reprise de la chaux")
etape("acheter", "Acheter", "acheter")
sc_buy = t("Acheter la chaux pour le salon", ["maison"], 30, "achat")
buy("Chaux pour le salon", "", "Matériaux", sc_buy)
etape("preparer", "Préparer la chaux", "preparer")
t("Éteindre la chaux et la laisser reposer", ["salon"], 120, note="Chaux vive = caustique : lunettes et gants.")
etape("appliquer", "Reprendre", "appliquer")
t("Reprendre la chaux aux endroits cassés", ["salon"], 240)

chantier("poteaux", "Salon : poteaux")
etape("decider", "Décider", "decider")
pot = t("Poteaux : peindre ou habiller ?", ["salon"], 30, "decision")
opt(pot, "Peindre", "Habiller (bois, corde, enduit…)")
etape("acheter", "Acheter", "acheter")
t("Acheter le nécessaire", ["maison"], 30, "achat")
etape("realiser", "Réaliser", "appliquer")
t("Traiter les poteaux", ["salon"], 480)

chantier("dalles", "Salon : tranches de dalles")
etape("decider", "Décider", "decider")
t("Comment couvrir le ciment apparent ?", ["salon"], 30, "decision")
etape("acheter", "Acheter", "acheter")
t("Acheter le nécessaire", ["maison"], 30, "achat")
etape("realiser", "Réaliser", "appliquer")
t("Couvrir les tranches de dalles", ["salon"], 480)

chantier("plancher", "Plancher au-dessus de la buanderie")
etape("concevoir", "Concevoir", "decider")
t("Choisir la structure et le bois", ["salon"], 60, "decision")
etape("acheter", "Acheter", "acheter")
t("Acheter le bois et la visserie", ["maison"], 60, "achat")
etape("construire", "Construire", "appliquer")
t("Poser le plancher", ["salon"], 960)

# ---------------------------------------------------------------- pièces
chantier("bureau", "Bureau : ranger et habiller le haut des murs", "haute")
etape("ranger", "Ranger", "preparer")
t("Ranger le bureau et virer le bazar", ["bureau"], 240, note="Débloque tout le reste de la pièce.")
etape("concevoir", "Décider", "decider")
t("Combler les trous des poutres : planches ou autre ?", ["bureau"], 30, "decision", prio="normale")
etape("acheter", "Acheter", "acheter")
t("Acheter les planches", ["maison"], 30, "achat", prio="normale")
etape("poser", "Poser", "appliquer")
t("Combler les trous en haut des murs", ["bureau"], 480, prio="normale")

chantier("boiseries-parents", "Notre chambre : boiseries")
etape("decider", "Décider", "decider")
bd = t("Les exploiter ou les fondre dans le mur ?", ["ch-parents"], 30, "decision")
opt(bd, "Les exploiter pour suspendre des choses", "Les peindre couleur mur pour les fondre")
etape("realiser", "Réaliser", "appliquer")
t("Réaliser l'option choisie", ["ch-parents"], 240)

chantier("penderie", "Penderie")
etape("concevoir", "Concevoir", "decider")
t("Dessiner le meuble et ses dimensions", ["maison"], 90, "decision")
etape("acheter", "Acheter", "acheter")
t("Acheter bois et quincaillerie", ["maison"], 60, "achat")
etape("construire", "Construire", "appliquer")
t("Construire la penderie", ["maison"], 960)

chantier("sous-escalier", "Meubles sous l'escalier")
etape("concevoir", "Concevoir", "decider")
t("Dessiner les meubles", ["salon"], 90, "decision")
etape("acheter", "Acheter", "acheter")
t("Acheter bois et quincaillerie", ["maison"], 60, "achat")
etape("construire", "Construire", "appliquer")
t("Construire les meubles", ["salon"], 960)

chantier("aile", "Autre aile", "normale", "Préférence : appartement. Mais un escalier depuis le salon réduit l'indépendance.")
etape("decider", "Décider", "decider")
ad = t("Escalier ou appartement indépendant ?", ["aile"], 60, "decision")
opt(ad, "Escalier depuis la maison", "Appartement indépendant")
esc = t("Escalier : extérieur ou depuis le salon ?", ["aile"], 60, "decision")
opt(esc, "Escalier extérieur", "Escalier depuis le salon")
etape("travaux", "Gros œuvre", "appliquer")
t("Monter le mur de séparation", ["aile"], 960)
t("Ouvrir derrière : terrasse et porte-fenêtre", ["aile"], 1920)

# ---------------------------------------------------------------- petits travaux (sans processus)
_cur.update(pid=None, prio="basse", stage=None, n=0)
tiroir = t("Séparateurs dans le tiroir à couverts", ["salon"], 15, "achat", key="petit.tiroir")
buy("Séparateurs de tiroir à couverts", "1", "", tiroir)

ids = {x["id"] for x in tasks}
for x in tasks:
    assert all(d in ids for d in x["depends_on"]), x["id"]
data = dict(version=4, members=["Joan", "Jacqueline"],
            rooms=[dict(id=a, name=b, sort=i) for i, (a, b) in enumerate(ROOMS)],
            projects=projects, stages=stages, tasks=tasks, options=options, shopping=shopping)
(ROOT / "data/backlog.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
print(len(projects), "chantiers,", len(stages), "étapes,", len(tasks), "tâches,",
      sum(len(x["rooms"]) for x in tasks), "cases,", len(shopping), "courses")
