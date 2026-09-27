# Collabora Online + les polices de la Ville (Interstate).
#
# POURQUOI UNE IMAGE DÉRIVÉE : l'image officielle n'a ni `fc-cache` ni `/usr/share/fonts`, et le conteneur ne joint
# pas l'URL publique (donc pas de `remote_font_config` en https). La seule voie fiable est d'ajouter les fichiers à
# l'image : LibreOffice lit ses polices dans /opt/collaboraoffice/share/fonts/truetype (c'est là que sont déjà tous
# les Noto/Liberation/Caladea de l'image), et fontconfig les indexe au démarrage.
#
# Les polices ne sont PAS versionnées (police commerciale de Font Bureau, cf. .gitignore) : il faut les déposer dans
# docker/fonts/interstate/ avant de construire l'image.
#
#   docker compose --profile bureau build collabora
FROM collabora/code:latest
COPY docker/fonts/interstate/ /opt/collaboraoffice/share/fonts/truetype/
