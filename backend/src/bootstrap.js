/** Amorçage idempotent au démarrage : organisme par défaut, compte de secours local. */
async function bootstrap(c) {
  const org = await c.organismes.ensureDefault(c.config.defaultOrganismeName);
  await c.refs.ensureSeeds(c.log);
  await c.circuits.ensureDefaults(org.id);
  await c.notifications.seedRules();
  await c.seances.ensureDefaultInstance(org.id);
  const created = await c.auth.ensureLocalAdmin();
  c.log.info({ organisme: org.code, compteDeSecoursCree: created, compteDeSecoursActif: c.config.localAdmin.enabled }, 'amorçage terminé');
  if (!c.config.bootstrapAdmins.length && !c.config.localAdmin.enabled) {
    c.log.warn("Aucun administrateur de plateforme n'est amorcé (BOOTSTRAP_ADMINS et LOCAL_ADMIN_* vides) : personne ne pourra administrer l'application");
  }
  return org;
}

module.exports = { bootstrap };
