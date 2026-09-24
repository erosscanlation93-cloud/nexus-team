import { PermissionFlagsBits } from 'discord.js';

// ¿Puede este usuario usar un comando con este nivel de permiso?
//  - 'admin'   → rol Admin (ROL_ADMIN_ID) o quien tenga permiso de Administrador del servidor
//  - 'miembro' → rol de miembros del scan (ROL_MIEMBROS_ID)
export function tienePermiso(interaction, permiso = 'admin') {
  const member = interaction.member;
  if (!member) return false;

  // member.roles puede venir como caché o como lista de IDs
  const roles = member.roles?.cache ? [...member.roles.cache.keys()] : (member.roles ?? []);
  const esAdmin = roles.includes(process.env.ROL_ADMIN_ID)
    || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  if (permiso === 'admin') return esAdmin;
  if (permiso === 'miembro') return roles.includes(process.env.ROL_MIEMBROS_ID);
  return false;
}
