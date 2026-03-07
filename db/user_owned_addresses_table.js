const userOwnedAddresses = [];

export function clearUserOwnedAddresses() {
  userOwnedAddresses.length = 0;
}

export function insertUserOwnedAddresses(rows) {
  for (const row of rows) {
    userOwnedAddresses.push({ ...row });
  }
}

export function listUserOwnedAddresses() {
  return userOwnedAddresses.map((row) => ({ ...row }));
}

export function findUserOwnedAddressById(id) {
  return userOwnedAddresses.find((row) => row.id === id) || null;
}

export function findUserOwnedAddressByUserAndAddress(userId, walletAddress) {
  return userOwnedAddresses.find(
    (row) => row.user_id === userId && row.wallet_address === walletAddress
  ) || null;
}

export function upsertUserOwnedAddress(row) {
  const index = userOwnedAddresses.findIndex((entry) => entry.id === row.id);
  if (index >= 0) {
    userOwnedAddresses[index] = { ...row };
    return { ...userOwnedAddresses[index] };
  }

  userOwnedAddresses.push({ ...row });
  return { ...row };
}

export function deleteUserOwnedAddress(id) {
  const index = userOwnedAddresses.findIndex((row) => row.id === id);
  if (index < 0) return false;
  userOwnedAddresses.splice(index, 1);
  return true;
}
