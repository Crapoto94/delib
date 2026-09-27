# ONLYOFFICE Document Server + les polices de la Ville (Interstate).
#
# Les polices personnalisées se déposent dans /usr/share/fonts/truetype/custom, puis la liste des polices est
# régénérée : sans `documentserver-generate-allfonts.sh`, le moteur ne voit pas les nouveaux fichiers (il sert une
# liste de polices figée, utilisée par la barre d'outils et par le convertisseur).
#
# Les polices ne sont PAS versionnées (police commerciale de Font Bureau, cf. .gitignore) : il faut les déposer dans
# docker/fonts/interstate/ avant de construire l'image.
#
#   docker compose --profile bureau build documentserver
FROM onlyoffice/documentserver:9.4
COPY docker/fonts/interstate/ /usr/share/fonts/truetype/custom/
RUN documentserver-generate-allfonts.sh
