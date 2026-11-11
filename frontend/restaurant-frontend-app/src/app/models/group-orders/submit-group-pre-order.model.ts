/** POST /group-reservations/{groupReservationId}/submit — request body */
export interface SubmitGroupPreOrderRequest {
  reservationId: string;
  /** Необов'язкова нотатка для ресторану, до NOTE_MAX_LENGTH символів. */
  note?: string;
  /** Необов'язковий бажаний час подачі, формат HH:mm. */
  serveAt?: string;
}

/** Додаткові поля Submit: у запит потрапляють лише непорожні. */
export interface SubmitExtras {
  note?: string;
  serveAt?: string;
}

export const NOTE_MAX_LENGTH = 300;

/** Швидкі теги над полем нотатки: клік додає готову фразу. */
export const QUICK_NOTE_TAGS: readonly { label: string; text: string }[] = [
  { label: 'Allergy', text: 'Allergy: ' },
  { label: 'Vegetarian', text: 'Vegetarian guests in the group' },
  { label: 'Birthday', text: 'Birthday celebration' },
  { label: 'No spice', text: 'Please no spicy dishes' },
  { label: 'High chair', text: 'High chair needed' },
];

/** POST /group-reservations/{groupReservationId}/submit — response item */
export interface SubmittedDish {
  dishId: string;
  quantity: number;
}
