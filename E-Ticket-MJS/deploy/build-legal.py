#!/usr/bin/env python3
# Génère public/conditions.html et public/confidentialite.html à partir des projets de textes.
# Les passages [entre crochets] deviennent des marques <mark class="todo"> : le serveur refuse de démarrer en
# production tant qu'il en reste ou que LEGAL_VALIDATED=1 n'est pas posé. Après validation par le service juridique :
# remplacer les crochets dans ce fichier, relancer ce script, puis définir LEGAL_VALIDATED=1.
import re, html, pathlib
OUT = pathlib.Path(__file__).resolve().parent.parent / 'public'

CGV = ("Conditions générales de vente", [
 ("Article 1 – Éditeur et objet", ["Le site E-Ticket est exploité par le Ministère de la Jeunesse et des Sports du Mali, [adresse et contact]. Il permet de réserver et d'acheter en ligne des billets pour les événements sportifs et culturels qu'il publie. Toute commande implique l'acceptation des présentes conditions."]),
 ("Article 2 – Billets", ["Chaque place donne lieu à un billet électronique identifié par un code unique, affiché sous forme de QR code. Le billet n'est pas nominatif. Il donne accès à un seul événement, dans la tribune indiquée."]),
 ("Article 3 – Prix", ["Les prix sont indiqués en francs CFA (FCFA), [toutes taxes comprises : à confirmer], par place et par tribune. Le prix retenu est celui affiché au moment de la commande. Le ministère peut modifier les prix à tout moment pour les commandes futures."]),
 ("Article 4 – Commande et réservation", ["L'acheteur choisit un événement, une tribune et de 1 à 6 places par commande. Les places sont réservées pendant 15 minutes. Sans paiement dans ce délai, la réservation est annulée et les places sont remises en vente."]),
 ("Article 5 – Paiement", ["Le paiement s'effectue par Mobile Money (Orange Money ; Moov Money [lorsque disponible]) sur la page de paiement de l'opérateur. Le site ne connaît ni ne conserve le code secret de l'acheteur. La commande n'est validée qu'après confirmation du paiement par l'opérateur. En cas de refus ou d'abandon, aucune somme n'est prélevée par le site."]),
 ("Article 6 – Remise du billet", ["Le billet est affiché sur le site dès la confirmation du paiement et reste accessible depuis le navigateur utilisé pour l'achat. L'acheteur peut le retrouver sur un autre appareil en demandant un code envoyé par SMS au numéro utilisé pour la commande. L'acheteur est responsable de la conservation de son billet."]),
 ("Article 7 – Accès au lieu de l'événement", ["L'accès se fait en présentant le QR code à la borne de contrôle. Un billet n'est accepté qu'une seule fois : le premier passage est validé, tout passage suivant avec le même billet est refusé. Le ministère ne peut être tenu responsable de l'entrée d'un tiers qui aurait copié ou obtenu le QR code d'un billet. Le règlement intérieur du lieu s'applique : [référence à compléter]."]),
 ("Article 8 – Annulation, report, modification", ["En cas d'annulation d'un événement, les billets sont remboursés au prix payé, sur le numéro Mobile Money utilisé pour la commande, sous [nombre] jours ouvrables. En cas de report, les billets restent valables pour la nouvelle date ; [conditions de remboursement en cas de non-disponibilité : à compléter]. Un changement d'horaire n'ouvre pas droit à remboursement [à valider]. En dehors de ces cas, les billets achetés ne sont ni repris ni échangés [à valider]."]),
 ("Article 9 – Paiement reçu après expiration", ["Si un paiement est confirmé après l'expiration de la réservation et que les places ne sont plus disponibles, la commande est remboursée intégralement sous [nombre] jours ouvrables. L'acheteur peut contacter le support en indiquant sa référence de commande."]),
 ("Article 10 – Revente et fraude", ["La revente des billets à un prix supérieur à leur prix d'achat, ou à des fins commerciales, est interdite. Le ministère peut refuser l'accès ou annuler un billet obtenu de manière frauduleuse [sans remboursement : à valider]."]),
 ("Article 11 – Responsabilité", ["Le ministère met en œuvre les moyens raisonnables pour assurer la disponibilité du site. Il n'est pas responsable des interruptions du réseau mobile, des opérateurs de paiement ou de SMS, ni des retards qui en résultent [dans les limites de la loi : à confirmer]."]),
 ("Article 12 – Support", ["Toute réclamation peut être adressée depuis la page Support du site, en indiquant la référence de commande, ou à [contact]."]),
 ("Article 13 – Droit applicable", ["Les présentes conditions sont soumises au droit malien. Tout litige relève des tribunaux de [ville] [à valider]."]),
])
CONF = ("Politique de confidentialité", [
 ("Article 1 – Responsable du traitement", ["Le Ministère de la Jeunesse et des Sports du Mali, [adresse et contact du responsable]."]),
 ("Article 2 – Données collectées", ["Le site enregistre :", ("ul", ["le numéro de téléphone saisi pour le paiement, l'opérateur choisi, le contenu et le montant de la commande, les codes des billets et la date d'utilisation à l'entrée ;", "le numéro de téléphone et le message éventuellement saisis dans le formulaire de support ;", "un code à usage unique envoyé par SMS, conservé sous forme chiffrée pendant 10 minutes, puis une session de 24 heures."]), "Le site ne demande ni nom, ni adresse électronique, ni pièce d'identité, et ne connaît pas les codes secrets Mobile Money. L'adresse IP sert uniquement à limiter les tentatives abusives et n'est pas enregistrée dans la base de données."]),
 ("Article 3 – Finalités", ["Ces données servent à : traiter et livrer les commandes, retrouver les billets sur un autre appareil, contrôler l'accès à l'événement, effectuer les remboursements, répondre au support, protéger le service contre la fraude, et établir des statistiques de fréquentation. Elles ne sont ni vendues ni utilisées pour de la prospection commerciale [à confirmer]."]),
 ("Article 4 – Durée de conservation", ["[À fixer par le ministère. Proposition : 12 mois après la date de l'événement, puis suppression ou anonymisation ; les données de transaction peuvent être conservées plus longtemps si une obligation comptable ou légale l'impose.]"]),
 ("Article 5 – Destinataires", ["Les données sont accessibles aux personnes habilitées du ministère, et transmises, dans la mesure nécessaire : à l'opérateur de paiement (Orange Money, [Moov Money]) pour le paiement, au fournisseur de SMS [nom] pour l'envoi du code, et à l'hébergeur [nom]."]),
 ("Article 6 – Hébergement et transferts", ["Les données sont hébergées en [pays], par [hébergeur]. [Préciser les garanties si l'hébergement est hors du Mali.]"]),
 ("Article 7 – Vos droits", ["Vous pouvez demander l'accès à vos données, leur rectification ou leur suppression [et vous opposer à leur traitement dans les conditions prévues par la loi]. Pour cela, écrivez à [contact], en indiquant le numéro de téléphone utilisé et une référence de commande. Une vérification d'identité par SMS peut être demandée."]),
 ("Article 8 – Autorité de contrôle", ["[Nom et coordonnées de l'autorité malienne de protection des données personnelles, et déclaration ou autorisation préalable éventuelle : à confirmer par le service juridique.]"]),
 ("Article 9 – Sécurité", ["Les échanges sont chiffrés (HTTPS) ; les codes d'accès aux commandes et les codes SMS sont conservés sous forme chiffrée ; le nombre de tentatives est limité ; l'accès administrateur est protégé par une clé secrète et ses actions sont journalisées. Aucune mesure ne garantit une sécurité absolue, notamment en cas de perte ou d'échange frauduleux de carte SIM."]),
 ("Article 10 – Stockage dans le navigateur", ["Le site mémorise dans votre navigateur, sans déposer de cookie publicitaire, l'identifiant de vos commandes et un jeton d'accès pour afficher vos billets. Les effacer supprime l'accès à vos billets depuis cet appareil ; ils restent récupérables par SMS."]),
 ("Article 11 – Modifications", ["Cette politique peut être mise à jour ; la date de la dernière version figure en tête de page : [date à compléter]."]),
])

def inline(t):
    t = html.escape(t, quote=False)
    return re.sub(r'\[([^\]]+)\]', lambda m: '<mark class="todo">[' + m.group(1) + ']</mark>', t)

def page(doc, other_href, other_name):
    title, arts = doc
    body = []
    for h, items in arts:
        body.append(f'<h2>{html.escape(h, quote=False)}</h2>')
        for it in items:
            if isinstance(it, tuple): body.append('<ul>' + ''.join(f'<li>{inline(x)}</li>' for x in it[1]) + '</ul>')
            else: body.append(f'<p>{inline(it)}</p>')
    return f'''<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} – E-Ticket Mali</title>
<link rel="stylesheet" href="/css/site.css"><script src="/js/common.js"></script>
<style>
main{{max-width:760px;margin:0 auto;padding:0 16px 48px}}a{{color:var(--vert)}}h1{{font-size:1.7rem;margin:28px 0 4px}}h2{{font-size:1.05rem;margin:26px 0 4px}}p,li{{margin:6px 0}}.sub{{color:var(--gris);margin:0 0 8px}}
mark.todo{{background:#fde68a;color:#3b2f00;padding:0 3px;border-radius:3px}}
#bandeau{{display:none;background:#fde68a;color:#3b2f00;border:1px solid #e3c04b;border-radius:10px;padding:10px 14px;margin:16px 0;font-size:.92rem}}
</style></head><body><main>
<h1>{title}</h1><p class="sub">Ministère de la Jeunesse et des Sports du Mali · E-Ticket</p>
<div id="bandeau"><b>Projet non validé.</b> Ce texte est un projet en attente de validation par le service juridique du ministère. Les passages surlignés sont à compléter. Il n'a aucune valeur contractuelle tant que cet avertissement est affiché.</div>
{chr(10).join(body)}
</main>
<script>fetch("/api/config").then(function(r){{return r.json()}}).then(function(c){{if(!c.legalValidated)document.getElementById("bandeau").style.display="block"}}).catch(function(){{}});</script>
</body></html>
'''
(OUT/'conditions.html').write_text(page(CGV, '/confidentialite.html', 'Politique de confidentialité'), encoding='utf-8')
(OUT/'confidentialite.html').write_text(page(CONF, '/conditions.html', 'Conditions de vente'), encoding='utf-8')
n = sum(len(re.findall(r'class="todo"', (OUT/f).read_text())) for f in ('conditions.html','confidentialite.html'))
print(f'Pages générées ; {n} passage(s) à compléter.')
