"use strict";
const reviewedRestaurantCorrections = window.HALIFAX_RESTAURANT_CORRECTIONS || { records: [], aliases: [], additions: [] };
HalifaxRestaurantCorrections.apply(restaurants, reviewedRestaurantCorrections, value => enrichRestaurant(value));
let savedAliasesChanged = false;
for (const restaurant of restaurants) for (const alias of restaurant.aliasIds || []) {
  if (state.saved.delete(alias)) { state.saved.add(restaurant.id); savedAliasesChanged = true; }
}
if (savedAliasesChanged) persistSaved();
activeRestaurants.splice(0, activeRestaurants.length, ...restaurants.filter(isRestaurantActive));
window.__halifaxRestaurantCount = restaurants.length;
