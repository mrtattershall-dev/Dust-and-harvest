class Form {
  title() { return this; }
  body() { return this; }
  button() { return this; }
  button1() { return this; }
  button2() { return this; }
  async show() { return { canceled: true }; }
}
export class ActionFormData extends Form {}
export class MessageFormData extends Form {}
