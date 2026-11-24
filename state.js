export const state = {
  selectedRole: null,
  authMode: 'login',
  user: null,
  apartments: [],
  payments: [],
  ownerProfiles: Object.create(null),
  followedApartmentIds: new Set(),
  selectedTypeTag: '',
  selectedFiles: [],
  selectedExistingPhotos: [],
  editingApartmentId: null
};
