# Cotecarte

Site de scan et de cote des cartes Pokémon et One Piece.

## Ce que fait la version 1

- **Scanner** : la caméra du téléphone lit le numéro imprimé en bas de la carte, par exemple `OP05-119`, `ST10-005` ou `199/165`. La lecture (OCR, avec Tesseract.js) se fait dans le navigateur, aucune photo n'est envoyée.
- **Choix de la version** : quand plusieurs cartes partagent un numéro (parallèle, reverse, autre extension), toutes s'affichent avec leur image et l'utilisateur choisit la sienne.
- **Cote** :
  - Pokémon : prix Cardmarket en euros, via l'API Pokémon TCG (gratuite, sans clé).
  - One Piece : prix TCGplayer en dollars, via OPTCG API (gratuite, sans clé).
- **Classeur** : quantités, tri par valeur, extension ou rareté, actualisation des prix, export et import. Il est enregistré sur l'appareil.
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
