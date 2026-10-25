# Cotecarte

Site de scan et de cote des cartes Pokémon et One Piece.

## Ce que fait la version 1

- **Scanner** : la caméra du téléphone lit le numéro imprimé en bas de la carte, par exemple `OP05-119`, `ST10-005`, `SVI FR 199/198` ou `199/165`. La lecture (OCR, avec Tesseract.js) se fait dans le navigateur, aucune photo n'est envoyée. Chaque image est nettoyée de trois façons (contraste, noir et blanc, inversé). Un numéro sans code d'extension doit être lu deux fois pour être accepté. Zoom et lampe s'affichent quand le téléphone les gère. Le bouton « Photo HD » passe par l'appareil photo natif, plus net.
- **Choix de la version** : quand plusieurs cartes partagent un numéro (parallèle, reverse, autre extension), toutes s'affichent avec leur image et l'utilisateur choisit la sienne.
- **Langue et prix** : l'utilisateur choisit la langue de sa carte (détectée d'office sur les Pokémon récents), puis ajuste le prix de son exemplaire, pré-rempli avec la cote.
- **Cote** :
  - Pokémon : prix Cardmarket en euros, via l'API Pokémon TCG (gratuite, sans clé).
  - One Piece : prix TCGplayer en dollars, via OPTCG API (gratuite, sans clé).
- **Classeur virtuel** : couverture, pages de 9 pochettes, anneaux, pages qui tournent (glisser ou flèches), intercalaires colorés. Rangement par série, type ou couleur, rareté, valeur, langue ou jeu ; classeurs Tout, Pokémon et One Piece. Une fiche par carte permet de modifier la langue, le prix et la quantité. Les prix saisis à la main ne sont pas écrasés par « Actualiser les prix ». Le classeur est enregistré sur l'appareil, avec export et import.
- **Sorties** : calendrier avec compte à rebours. La liste se met à jour dans `app.js`, tableau `RELEASES`.

## Mise en ligne gratuite

La caméra exige le **https**. Les trois hébergeurs ci-dessous le fournissent.

1. **Netlify Drop** (le plus simple, depuis un ordinateur) : ouvrir app.netlify.com/drop et glisser le dossier.
2. **GitHub Pages** : déposer les fichiers dans un dépôt, puis Settings → Pages → branche `main`.
3. **Vercel** : importer le dépôt GitHub.

## Limites connues

- L'API One Piece donne des prix du marché américain. Pour la cote européenne, chaque carte renvoie vers Cardmarket.
- Si une API ne répond pas ou refuse l'accès depuis le navigateur (CORS), le site le signale et propose le lien Cardmarket.
- Les extensions toutes récentes peuvent mettre quelques jours à apparaître dans les API.
- Le classeur n'est pas encore lié à un compte. Changer d'appareil demande un export puis un import.

## Prochaines étapes envisagées

- Comptes utilisateurs et classeur synchronisé (Supabase, offre gratuite).
- Liens d'affiliation Cardmarket pour la monétisation.
- Prix One Piece en euros, si une source fiable se présente.
- Pages SEO par carte pour attirer du trafic.
