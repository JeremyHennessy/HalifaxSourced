"use strict";
const reviewedRestaurantCorrections = window.HALIFAX_RESTAURANT_CORRECTIONS || { records: [], aliases: [], additions: [] };
HalifaxRestaurantCorrections.apply(restaurants, reviewedRestaurantCorrections, value => enrichRestaurant(value));
for (const alias of reviewedRestaurantCorrections.aliases) if (state.saved.delete(alias.from)) state.saved.add(alias.to);
activeRestaurants.splice(0, activeRestaurants.length, ...restaurants.filter(isRestaurantActive));
window.__halifaxRestaurantCount = restaurants.length;
