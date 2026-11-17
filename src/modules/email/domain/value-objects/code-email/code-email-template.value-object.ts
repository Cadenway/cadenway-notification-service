/**
 * Type CodeEmailTemplate
 *
 * @description
 * The templates of the code e-mails this service sends, named after their purpose: the
 * "Confirmation de l’adresse" and "Code de connexion" e-mails of the Emails artboard of the
 * mockup, and the code that confirms a new address (`email-change`, new copy in the style of
 * "Code de connexion": the artboard has no template for it).
 *
 * @type {'email-verification' | 'sign-in' | 'email-change'}
 */
export type CodeEmailTemplate = 'email-verification' | 'sign-in' | 'email-change';
