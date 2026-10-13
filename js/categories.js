const make = (slug, name, icon, color, order) =>
  ({ id: `cat-${slug}`, name, icon, color, order, updatedAt: 0, deleted: false });

export const DEFAULT_CATEGORIES = [
  make('food', 'Food & Drink', 'food', '#c2643c', 0),
  make('transport', 'Transport', 'car', '#b8862b', 1),
  make('groceries', 'Groceries', 'cart', '#4d7c6b', 2),
  make('bills', 'Bills', 'bill', '#6b62b5', 3),
  make('shopping', 'Shopping', 'bag', '#a85a7a', 4),
  make('home', 'Home', 'home', '#7a6a55', 5),
  make('health', 'Health', 'heart', '#c0504d', 6),
  make('fun', 'Fun', 'play', '#3f7fa0', 7),
  make('subscriptions', 'Subscriptions', 'repeat', '#5f6fb0', 8),
  make('selfcare', 'Self-care', 'sparkle', '#b0707a', 9),
  make('business', 'Business', 'briefcase', '#5a6b4a', 10),
  make('other', 'Other', 'dots', '#8a8178', 11),
];

export const CATEGORY_COLORS = DEFAULT_CATEGORIES.map((c) => c.color);

export const OTHER_ID = 'cat-other';
