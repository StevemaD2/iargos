export interface GeoPoint {
  lat: number;
  lng: number;
}

export const requestCurrentLocation = (options?: PositionOptions): Promise<GeoPoint | null> => {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 0,
        ...options
      }
    );
  });
};
