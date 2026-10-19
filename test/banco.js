// Banco de preguntas del test gratuito de alérgenos (meseo.es/test/).
//
// Preguntas GENÉRICAS de sala: no dependen de la carta de ningún restaurante.
// Cinco temas; cada test saca dos de cada uno (ver logica.js).
//   catorce     los 14 alérgenos de declaración obligatoria
//   escondidos  alérgenos que no se ven en el nombre del plato
//   cruzada     contaminación cruzada en cocina y en sala
//   protocolo   qué se hace en sala (comanda, avisos, alergia o intolerancia)
//   emergencia  qué hacer ante una reacción
//
// Formato: { id, tema, q:{es,en}, o:{es:[4],en:[4]}, c: índice de la correcta, x:{es,en} }
// x es la explicación en una frase que ve el camarero si falla.
//
// FUENTES (consultadas en octubre de 2026):
// - Reglamento (UE) 1169/2011, anexo II (texto consolidado, EUR-Lex):
//   https://eur-lex.europa.eu/legal-content/ES/TXT/HTML/?uri=CELEX%3A02011R1169-20180101
//   14 grupos. Cereales con gluten: trigo (espelta, khorasan), centeno, cebada, avena.
//   Frutos de cáscara: almendra, avellana, nuez, anacardo, pacana, nuez de Brasil,
//   pistacho, macadamia (el piñón NO está). Cacahuete y frutos de cáscara son grupos
//   distintos; crustáceos y moluscos también. Leche y derivados, lactosa incluida.
//   Sulfitos: más de 10 mg/kg o 10 mg/l en SO2 total.
// - Real Decreto 126/2015, art. 4 y 6 (BOE-A-2015-2293):
//   https://www.boe.es/buscar/act.php?id=BOE-A-2015-2293
//   En alimentos sin envasar la información de alérgenos es obligatoria; puede darse
//   de palabra si está registrada por escrito o en soporte electrónico en el local,
//   accesible al personal, a la inspección y al cliente que la pida.
// - AESAN, etiquetado de sustancias que causan alergias e intolerancias:
//   https://www.aesan.gob.es/en/seguridad-alimentaria/informacion-alimentaria/etiquetado-sustancias
// - Guía GALAXIA de anafilaxia para pacientes (SEAIC): https://seaic.org/download/5912
//   Llamar al 112 diciendo que es una anafilaxia; autoinyector en la cara externa del
//   muslo; en caso de duda, ponerlo; tumbado con piernas elevadas (sentado si le cuesta
//   respirar o vomita); que no se levante ni camine; la inyección no sustituye al médico.
// Lo demás (salsa de soja con trigo, tahini en el hummus, apio en caldos, aceite de
// freidora compartido, que el calor no elimina el alérgeno) es conocimiento de oficio
// indiscutible y, cuando depende de la marca, la pregunta lo dice y manda a la ficha.
// Nada de esto es consejo médico: es el protocolo básico de sala.

export const TEMAS = ['catorce', 'escondidos', 'cruzada', 'protocolo', 'emergencia'];

export const TEMA_NOMBRE = {
  catorce:    { es: 'Los 14 alérgenos',        en: 'The 14 allergens' },
  escondidos: { es: 'Alérgenos escondidos',    en: 'Hidden allergens' },
  cruzada:    { es: 'Contaminación cruzada',   en: 'Cross contact' },
  protocolo:  { es: 'Protocolo de sala',       en: 'Floor protocol' },
  emergencia: { es: 'Si hay una reacción',     en: 'If someone reacts' },
};

export const PREGUNTAS = [
  // ───────────── Los 14 ─────────────
  { id: 'c1', tema: 'catorce',
    q: { es: '¿Cuántos alérgenos hay que declarar por ley en la Unión Europea?',
         en: 'How many allergens must be declared by law in the European Union?' },
    o: { es: ['12', '16', '14', '10'], en: ['12', '16', '14', '10'] },
    c: 2,
    x: { es: 'El Reglamento (UE) 1169/2011, en su anexo II, fija 14 grupos de alérgenos.',
         en: 'Regulation (EU) 1169/2011, Annex II, sets 14 allergen groups.' } },

  { id: 'c2', tema: 'catorce',
    q: { es: '¿Cuál de estos NO está en la lista de los 14?',
         en: 'Which of these is NOT on the list of 14?' },
    o: { es: ['Piñones', 'Altramuz', 'Apio', 'Mostaza'],
         en: ['Pine nuts', 'Lupin beans', 'Celery', 'Mustard'] },
    c: 0,
    x: { es: 'Los frutos de cáscara de la lista son almendra, avellana, nuez, anacardo, pacana, nuez de Brasil, pistacho y macadamia; el piñón no está, aunque si un cliente dice que le da alergia se trata igual de en serio.',
         en: 'The listed tree nuts are almond, hazelnut, walnut, cashew, pecan, Brazil nut, pistachio and macadamia; pine nuts are not, but if a guest says they react to them you take it just as seriously.' } },

  { id: 'c3', tema: 'catorce',
    q: { es: '¿Dónde entra el cacahuete en la lista?',
         en: 'Where do peanuts sit on the list?' },
    o: { es: ['Dentro de los frutos de cáscara', 'Dentro de la soja, por ser legumbre', 'No es de declaración obligatoria', 'Tiene su propio grupo, aparte'],
         en: ['Inside the tree nuts group', 'Inside soy, as a legume', 'They are not a mandatory allergen', 'They have their own group'] },
    c: 3,
    x: { es: 'El cacahuete es un alérgeno propio, separado de los frutos de cáscara: un alérgico a uno no tiene por qué serlo al otro.',
         en: 'Peanuts are an allergen on their own, separate from tree nuts: someone allergic to one is not necessarily allergic to the other.' } },

  { id: 'c4', tema: 'catorce',
    q: { es: 'Un cliente es alérgico a los moluscos. ¿Cuál de estos platos los lleva?',
         en: 'A guest is allergic to molluscs. Which of these dishes contains them?' },
    o: { es: ['Gambas al ajillo', 'Mejillones a la marinera', 'Cigalas a la plancha', 'Arroz meloso con bogavante azul'],
         en: ['Garlic prawns', 'Mussels marinière', 'Grilled langoustines', 'Lobster rice'] },
    c: 1,
    x: { es: 'Gamba, cigala y bogavante son crustáceos; mejillón, almeja, pulpo y calamar son moluscos, y son dos alérgenos distintos.',
         en: 'Prawn, langoustine and lobster are crustaceans; mussel, clam, octopus and squid are molluscs, and they are two different allergens.' } },

  { id: 'c5', tema: 'catorce',
    q: { es: '¿Qué cereales cuentan como «cereales que contienen gluten»?',
         en: 'Which grains count as "cereals containing gluten"?' },
    o: { es: ['Trigo, centeno, cebada y avena', 'Solo el trigo y la espelta', 'Trigo, maíz y arroz', 'Todos los cereales sin excepción'],
         en: ['Wheat, rye, barley and oats', 'Only wheat and spelt', 'Wheat, corn and rice', 'Every cereal, no exceptions'] },
    c: 0,
    x: { es: 'El anexo II nombra trigo (con espelta y khorasan), centeno, cebada y avena; el maíz y el arroz no están.',
         en: 'Annex II names wheat (including spelt and khorasan), rye, barley and oats; corn and rice are not on it.' } },

  { id: 'c6', tema: 'catorce',
    q: { es: '¿Cuándo hay que declarar los sulfitos?',
         en: 'When must sulphites be declared?' },
    o: { es: ['Siempre, aunque haya una cantidad mínima', 'Solo en los vinos tintos y rosados', 'Por encima de 10 mg por kilo o por litro', 'Solo si los añade la propia cocina'],
         en: ['Always, even in a tiny amount', 'Only in red and rosé wines', 'Above 10 mg per kilo or per litre', 'Only if the kitchen adds them by hand'] },
    c: 2,
    x: { es: 'El anexo II los incluye por encima de 10 mg/kg o 10 mg/l, expresados como SO2 total.',
         en: 'Annex II includes them above 10 mg/kg or 10 mg/l, expressed as total SO2.' } },

  { id: 'c7', tema: 'catorce',
    q: { es: 'El alérgeno «leche», ¿incluye la lactosa?',
         en: 'Does the "milk" allergen include lactose?' },
    o: { es: ['No, la lactosa se declara aparte', 'Solo si el plato lleva nata o mantequilla', 'Solo la leche cruda de vaca', 'Sí, leche y derivados, lactosa incluida'],
         en: ['No, lactose is declared separately', 'Only if the dish has cream, butter or yoghurt', 'Only raw cow milk', 'Yes, milk and its products, lactose included'] },
    c: 3,
    x: { es: 'El punto 7 del anexo II es «leche y sus derivados (incluida la lactosa)».',
         en: 'Point 7 of Annex II reads "milk and products thereof (including lactose)".' } },

  // ───────────── Escondidos ─────────────
  { id: 'e1', tema: 'escondidos',
    q: { es: 'La salsa de soja habitual, ¿qué alérgenos lleva?',
         en: 'What allergens does regular soy sauce contain?' },
    o: { es: ['Solo soja', 'Soja y sésamo', 'Ninguno, porque es fermentada', 'Soja y gluten, por el trigo'],
         en: ['Only soy', 'Soy and sesame', 'None, because it has been fermented', 'Soy and gluten, from the wheat'] },
    c: 3,
    x: { es: 'La salsa de soja habitual se hace con soja y trigo; algunos tamaris no llevan trigo, pero hay que mirar la etiqueta.',
         en: 'Regular soy sauce is brewed with soy and wheat; some tamari has no wheat, but you check the label.' } },

  { id: 'e2', tema: 'escondidos',
    q: { es: 'Un pesto genovés clásico, ¿qué alérgeno lleva seguro?',
         en: 'Which allergen is always in a classic Genovese pesto?' },
    o: { es: ['Huevo, para ligarlo', 'Leche, por el queso', 'Mostaza, para darle punto', 'Ninguno, es albahaca y aceite'],
         en: ['Egg, to bind it', 'Milk, from the cheese', 'Mustard, for a kick', 'None, just basil and oil'] },
    c: 1,
    x: { es: 'Lleva queso curado (leche); el piñón no está entre los 14, pero muchas versiones llevan nuez o anacardo, así que se mira la receta.',
         en: 'It has aged cheese (milk); pine nuts are not among the 14, but many versions use walnut or cashew, so you check the recipe.' } },

  { id: 'e3', tema: 'escondidos',
    q: { es: 'El surimi (los palitos «de cangrejo»), ¿qué lleva?',
         en: 'What is in surimi ("crab" sticks)?' },
    o: { es: ['Cangrejo, así que crustáceo', 'Solo soja, almidón y algo de azúcar', 'Pescado, y según la marca huevo o gluten', 'Nada que haya que declarar'],
         en: ['Crab, so crustacean', 'Only soy, starch and a little sugar', 'Fish, and egg or gluten by brand', 'Nothing that must be declared'] },
    c: 2,
    x: { es: 'Se hace con pasta de pescado y muchas marcas añaden clara de huevo, almidón de trigo o aroma de crustáceo: se mira la ficha.',
         en: 'It is made from fish paste and many brands add egg white, wheat starch or crustacean flavouring: check the spec sheet.' } },

  { id: 'e4', tema: 'escondidos',
    q: { es: 'La vinagreta de la casa lleva una cucharadita de mostaza de Dijon. ¿Hay que decirlo?',
         en: 'The house vinaigrette has a teaspoon of Dijon mustard. Do you need to mention it?' },
    o: { es: ['Sí, la mostaza es alérgeno', 'No, en tan poca cantidad no cuenta', 'Solo si el cliente lo pregunta', 'No, la mostaza es una especia'],
         en: ['Yes, mustard is an allergen', 'No, such a small amount does not count', 'Only if the guest asks', 'No, mustard is just a spice'] },
    c: 0,
    x: { es: 'La mostaza está entre los 14 y se declara aunque vaya en poca cantidad dentro de una salsa.',
         en: 'Mustard is one of the 14 and is declared even in a small amount inside a sauce.' } },

  { id: 'e5', tema: 'escondidos',
    q: { es: '¿Qué alérgeno lleva el hummus clásico?',
         en: 'Which allergen is in classic hummus?' },
    o: { es: ['Cacahuete', 'Altramuz', 'Ninguno, es solo garbanzo cocido', 'Sésamo, por el tahini'],
         en: ['Peanut', 'Lupin', 'None, it is only cooked chickpea', 'Sesame, from the tahini'] },
    c: 3,
    x: { es: 'El hummus clásico lleva tahini, que es pasta de sésamo.',
         en: 'Classic hummus contains tahini, which is sesame paste.' } },

  { id: 'e6', tema: 'escondidos',
    q: { es: 'Un cliente pregunta qué alérgeno puede llevar una copa de vino.',
         en: 'A guest asks which allergen a glass of wine may contain.' },
    o: { es: ['Gluten', 'Sulfitos', 'Ninguno, es natural', 'Mostaza'],
         en: ['Gluten', 'Sulphites', 'None, it is natural', 'Mustard'] },
    c: 1,
    x: { es: 'La gran mayoría de los vinos pasan de 10 mg/l de sulfitos y por eso la etiqueta dice «contiene sulfitos».',
         en: 'Most wines are above 10 mg/l of sulphites, which is why the label says "contains sulphites".' } },

  { id: 'e7', tema: 'escondidos',
    q: { es: 'Un risotto se hace con caldo o fondo comprado. ¿Qué alérgeno suele esconder?',
         en: 'A risotto uses a bought stock. Which allergen does it often hide?' },
    o: { es: ['Altramuz', 'Sésamo', 'Apio', 'Cacahuete'],
         en: ['Lupin', 'Sesame', 'Celery', 'Peanut'] },
    c: 2,
    x: { es: 'El apio es muy habitual en caldos, fondos y sofritos industriales: se mira la ficha del producto.',
         en: 'Celery is very common in commercial stocks, bases and sofritos: check the product sheet.' } },

  { id: 'e8', tema: 'escondidos',
    q: { es: '¿Dónde puede aparecer escondido el altramuz?',
         en: 'Where can lupin be hidden?' },
    o: { es: ['En el aceite de girasol', 'En la harina de algunos panes y bollos', 'En la sal en escamas', 'En el café de cápsula con leche en polvo'],
         en: ['In sunflower oil', 'In the flour of some breads and pastries', 'In flaky salt', 'In capsule coffee with powdered milk'] },
    c: 1,
    x: { es: 'La harina de altramuz se usa en algunos panes, bollería y rebozados, y es uno de los 14.',
         en: 'Lupin flour is used in some breads, pastries and batters, and it is one of the 14.' } },

  // ───────────── Contaminación cruzada ─────────────
  { id: 'x1', tema: 'cruzada',
    q: { es: 'Las patatas se fríen en la misma freidora que los calamares rebozados. ¿Son aptas para un celíaco?',
         en: 'Fries are cooked in the same fryer as battered squid. Are they safe for a coeliac guest?' },
    o: { es: ['Sí, la patata no tiene gluten', 'Sí, si el aceite pasa de 180 grados', 'No, el aceite compartido pasa gluten', 'Sí, si se escurren muy bien antes de servir'],
         en: ['Yes, potatoes have no gluten', 'Yes, if the oil is above 180 degrees', 'No, shared oil carries gluten over', 'Yes, if they are drained really well first'] },
    c: 2,
    x: { es: 'El aceite compartido arrastra restos del rebozado (gluten, y aquí también molusco), y la temperatura no los elimina.',
         en: 'Shared oil carries batter residue (gluten, and here mollusc too), and heat does not remove it.' } },

  { id: 'x2', tema: 'cruzada',
    q: { es: '¿El calor del horno o de la plancha elimina el alérgeno?',
         en: 'Does the heat of the oven or griddle destroy the allergen?' },
    o: { es: ['No, cocinar no lo hace seguro', 'Sí, por encima de 100 grados', 'Solo en el caso de los lácteos', 'Sí, si se cocina más de diez minutos'],
         en: ['No, cooking does not make it safe', 'Yes, above 100 degrees', 'Only for dairy', 'Yes, if cooked for over ten minutes'] },
    c: 0,
    x: { es: 'Cocinar no elimina con seguridad la proteína que causa la reacción: un plato con alérgeno sigue teniéndolo.',
         en: 'Cooking does not reliably destroy the protein that causes the reaction: a dish with the allergen still has it.' } },

  { id: 'x3', tema: 'cruzada',
    q: { es: 'Has servido una ensalada con nueces y el cliente avisa de que es alérgico. ¿Qué haces?',
         en: 'You served a salad with walnuts and the guest says they are allergic. What do you do?' },
    o: { es: ['Retirar las nueces con cuidado', 'Pedir a cocina una nueva, desde cero', 'Lavar bien las hojas y volver a servirla', 'Quitarlas si solo había dos o tres'],
         en: ['Pick the walnuts out carefully', 'Ask the kitchen for a new one from scratch', 'Rinse the leaves well and serve it to them again', 'Remove them if there were only a few'] },
    c: 1,
    x: { es: 'Quitar el alérgeno no basta porque quedan restos: el plato se hace de nuevo y se avisa a cocina.',
         en: 'Removing the allergen is not enough because traces stay: the dish is made again and the kitchen is told.' } },

  { id: 'x4', tema: 'cruzada',
    q: { es: '¿Cómo llevas a la mesa el plato de un cliente alérgico?',
         en: 'How do you carry an allergic guest\'s dish to the table?' },
    o: { es: ['En la misma bandeja que los demás', 'Lo lleva quien esté libre, sin avisar', 'Como cualquier otro, el orden no importa nada', 'Aparte, identificado, sin pasar sobre otros'],
         en: ['On the same tray as the rest', 'Whoever is free takes it, no need to say', 'Like any other dish, the order does not matter at all', 'Separately, marked, not over other plates'] },
    c: 3,
    x: { es: 'Se lleva separado e identificado para que no le caiga nada encima ni acabe delante de otro comensal.',
         en: 'It goes separately and marked so nothing drops on it and it does not end up in front of someone else.' } },

  { id: 'x5', tema: 'cruzada',
    q: { es: 'Un cliente celíaco pide pan sin gluten. ¿Cómo lo preparas?',
         en: 'A coeliac guest asks for gluten free bread. How do you prepare it?' },
    o: { es: ['En la misma tabla, limpiando las migas', 'Tostado en la tostadora de siempre', 'Con tabla y cuchillo limpios, servido aparte', 'En la cesta común, en un lado y bien envuelto'],
         en: ['On the usual board, brushing off crumbs', 'Toasted in the usual toaster', 'With a clean board and knife, served apart', 'In the shared basket, to one side and well wrapped'] },
    c: 2,
    x: { es: 'Las migas del pan normal bastan para contaminarlo: utensilios limpios o separados y nunca en la cesta común.',
         en: 'Crumbs from regular bread are enough to contaminate it: clean or separate tools and never in the shared basket.' } },

  { id: 'x6', tema: 'cruzada',
    q: { es: 'En el pase usas el mismo cucharón para dos salsas distintas. ¿Está bien?',
         en: 'At the pass you use the same ladle for two different sauces. Is that fine?' },
    o: { es: ['No, cada salsa con su utensilio', 'Sí, si lo pasas por una servilleta', 'Sí, si las salsas se parecen', 'Sí, en pleno servicio no hay tiempo'],
         en: ['No, each sauce gets its own utensil', 'Yes, if you wipe it with a napkin', 'Yes, if the sauces are similar', 'Yes, in the middle of service there is no time'] },
    c: 0,
    x: { es: 'Un utensilio compartido pasa el alérgeno de una salsa a otra; limpiarlo con una servilleta no es suficiente.',
         en: 'A shared utensil carries the allergen from one sauce to another; wiping it with a napkin is not enough.' } },

  { id: 'x7', tema: 'cruzada',
    q: { es: 'La ficha de un postre dice «puede contener trazas de frutos de cáscara». El cliente es alérgico.',
         en: 'A dessert sheet says "may contain traces of tree nuts". The guest is allergic.' },
    o: { es: ['No se dice, son cantidades mínimas', 'Solo importa si se trata del gluten', 'Se calla para no asustar al resto de la mesa', 'Se le dice: le pueden bastar trazas'],
         en: ['Say nothing, the amounts are tiny', 'It only matters for gluten', 'Keep quiet so the table is not worried', 'Tell them: traces can be enough'] },
    c: 3,
    x: { es: 'A una persona alérgica le pueden bastar cantidades muy pequeñas, así que la decisión es suya con la información completa.',
         en: 'A very small amount can be enough for an allergic person, so they decide with the full information.' } },

  // ───────────── Protocolo de sala ─────────────
  { id: 'p1', tema: 'protocolo',
    q: { es: '¿Cuándo preguntas por alergias o intolerancias?',
         en: 'When do you ask about allergies or intolerances?' },
    o: { es: ['Solo si el cliente lo menciona', 'Al empezar, a toda la mesa', 'Cuando sacas los postres', 'Solo si hay niños en la mesa'],
         en: ['Only if the guest brings it up', 'At the start, to the whole table', 'When you bring the desserts', 'Only if there are children at the table'] },
    c: 1,
    x: { es: 'Se pregunta a toda la mesa antes de tomar nota, porque muchos clientes no lo dicen si nadie les pregunta.',
         en: 'You ask the whole table before taking the order, because many guests do not say it unless asked.' } },

  { id: 'p2', tema: 'protocolo',
    q: { es: 'Te preguntan si un plato lleva frutos secos y no estás seguro. ¿Qué dices?',
         en: 'You are asked if a dish has nuts and you are not sure. What do you say?' },
    o: { es: ['«Que yo sepa no, puede pedirlo»', '«Mejor pida otro plato, por si acaso»', '«Lo compruebo con cocina ahora mismo»', '«Pídalo y si acaso lo aparta»'],
         en: ['"Not as far as I know, go ahead"', '"Better order something else, just in case"', '"I will check with the kitchen right now"', '"Order it and pick them out if needed"'] },
    c: 2,
    x: { es: 'Nunca se dice «no lleva» sin comprobarlo: se pregunta a cocina o se mira la ficha de alérgenos.',
         en: 'You never say "it does not have it" without checking: ask the kitchen or look at the allergen sheet.' } },

  { id: 'p3', tema: 'protocolo',
    q: { es: 'Una clienta te dice que es alérgica al huevo. ¿A quién avisas?',
         en: 'A guest tells you she is allergic to egg. Who do you tell?' },
    o: { es: ['A cocina en la comanda y a quien vaya a servir', 'A nadie, ya lo tienes tú en la cabeza', 'Al jefe de cocina, cuando acabe el servicio de hoy', 'Solo al compañero de la barra'],
         en: ['The kitchen on the ticket, and whoever serves', 'Nobody, you will remember it', 'The head chef, once today\'s service has finished', 'Only the colleague at the bar'] },
    c: 0,
    x: { es: 'La alergia va escrita y bien visible en la comanda, y lo sabe todo el que toque o lleve ese plato.',
         en: 'The allergy goes clearly on the ticket and everyone who handles or carries the dish knows it.' } },

  { id: 'p4', tema: 'protocolo',
    q: { es: 'En España, ¿se puede dar la información de alérgenos de palabra?',
         en: 'In Spain, can allergen information be given verbally?' },
    o: { es: ['No, tiene que estar impresa en la carta', 'Sí, sin necesidad de tenerla escrita', 'Solo en restaurantes de menú del día', 'Sí, si además está por escrito en el local'],
         en: ['No, it must be printed on the menu', 'Yes, with no need to have it written', 'Only in set menu restaurants', 'Yes, if it is also written down on site'] },
    c: 3,
    x: { es: 'El Real Decreto 126/2015 permite darla de palabra si está registrada por escrito o en formato electrónico en el local y el cliente puede consultarla.',
         en: 'Royal Decree 126/2015 allows it verbally if it is recorded in writing or electronically on site and the guest can see it.' } },

  { id: 'p5', tema: 'protocolo',
    q: { es: '¿Qué diferencia hay entre una alergia y una intolerancia?',
         en: 'What is the difference between an allergy and an intolerance?' },
    o: { es: ['Son lo mismo con distinto nombre', 'La alergia es inmunitaria y puede ser grave', 'La intolerancia es siempre más grave', 'La alergia solo produce picor y granos en la piel'],
         en: ['They are the same thing', 'An allergy is immune and can be severe', 'An intolerance is always more serious', 'An allergy only ever causes itchy skin and a rash'] },
    c: 1,
    x: { es: 'La alergia la provoca el sistema inmunitario y puede ser grave incluso con trazas; una intolerancia, como la de la lactosa, suele depender de la cantidad.',
         en: 'An allergy is an immune reaction and can be severe even with traces; an intolerance, like lactose, usually depends on the amount.' } },

  { id: 'p6', tema: 'protocolo',
    q: { es: 'Un cliente dice que es intolerante a la lactosa. ¿Cómo lo tratas?',
         en: 'A guest says they are lactose intolerant. How do you handle it?' },
    o: { es: ['Igual que todo, que no es grave', 'Le pides que pruebe un poco antes', 'Con cuidado: a cocina y sin improvisar', 'Le pides que traiga un informe médico'],
         en: ['Like any order, it is not serious', 'You ask them to try a little first', 'With care: to the kitchen, no guessing', 'You ask for a medical report'] },
    c: 2,
    x: { es: 'En sala no se juzga quién es alérgico o intolerante: se comunica a cocina y se comprueba igual.',
         en: 'On the floor you do not judge who is allergic or intolerant: you tell the kitchen and check just the same.' } },

  { id: 'p7', tema: 'protocolo',
    q: { es: 'Un cliente alérgico a la leche pide el plato sin queso. ¿Qué haces?',
         en: 'A guest allergic to milk wants the dish without cheese. What do you do?' },
    o: { es: ['Lo comandas como cambio por alergia', 'Quitas el queso tú mismo en el pase', 'Le dices que no se hacen cambios', 'Lo sirves tal cual y que lo aparte'],
         en: ['Put it through as an allergy change', 'Take the cheese off yourself at the pass', 'Tell them no changes are allowed', 'Serve it as is and let them remove it'] },
    c: 0,
    x: { es: 'El cambio lo decide y lo hace cocina, que sabe si la leche está también en la salsa o en la base.',
         en: 'The kitchen decides and makes the change, because it knows whether milk is also in the sauce or the base.' } },

  { id: 'p8', tema: 'protocolo',
    q: { es: 'Una clienta dice que es «solo un poco alérgica» al marisco. ¿Qué haces?',
         en: 'A guest says she is "only a little allergic" to shellfish. What do you do?' },
    o: { es: ['Le dejas tomar un poco', 'Lo apuntas como preferencia, no alergia', 'Le recomiendas el pescado, por si acaso', 'Sigues el protocolo de alergia completo'],
         en: ['Let her have a little', 'Note it as a preference, not an allergy', 'Suggest the fish instead, just in case', 'Follow the full allergy protocol'] },
    c: 3,
    x: { es: 'Una reacción puede ser más fuerte que otras veces, así que cualquier alergia se trata con el protocolo entero.',
         en: 'A reaction can be stronger than previous ones, so any allergy gets the full protocol.' } },

  // ───────────── Si hay una reacción ─────────────
  { id: 'm1', tema: 'emergencia',
    q: { es: 'Un cliente empieza a respirar mal y se le hinchan los labios después de comer. ¿Qué haces primero?',
         en: 'A guest starts struggling to breathe and their lips swell after eating. What do you do first?' },
    o: { es: ['Esperar un poco a ver si se pasa', 'Avisar al encargado y llamar al 112', 'Darle agua y acompañarle al baño', 'Sacarle a la calle a tomar el aire un rato'],
         en: ['Wait a moment to see if it passes', 'Alert the manager and call 112', 'Give them water and take them to the toilet', 'Walk them outside for fresh air'] },
    c: 1,
    x: { es: 'Se pide ayuda médica cuanto antes: al 112 se le dice que puede ser una reacción alérgica grave.',
         en: 'Get medical help as soon as possible: tell 112 it may be a severe allergic reaction.' } },

  { id: 'm2', tema: 'emergencia',
    q: { es: 'El cliente lleva un autoinyector de adrenalina. ¿Qué sabes de él?',
         en: 'The guest carries an adrenaline auto-injector. What do you know about it?' },
    o: { es: ['Se espera a la ambulancia para usarlo', 'Se pone en el brazo, en la vena', 'Solo puede ponerlo un médico', 'Se pone en la parte externa del muslo'],
         en: ['You wait for the ambulance to use it', 'It goes in the arm, into a vein', 'Only a doctor can use it', 'It goes into the outer thigh'] },
    c: 3,
    x: { es: 'Se aplica en la cara externa del muslo; si lo necesita, le ayudas a usarlo y sigues las indicaciones del 112.',
         en: 'It goes into the outer thigh; if they need it you help them use it and follow what 112 tells you.' } },

  { id: 'm3', tema: 'emergencia',
    q: { es: 'Mientras llega la ambulancia, ¿cómo tiene que estar el cliente?',
         en: 'While the ambulance is on its way, how should the guest be?' },
    o: { es: ['Tumbado, piernas en alto, sin levantarse', 'De pie y caminando un poco', 'Solo y tranquilo, sin gente alrededor', 'De pie y apoyado, para que respire mejor'],
         en: ['Lying down, legs up, not getting up', 'Standing and walking a little', 'Alone and calm, with nobody around', 'Standing and leaning on something to breathe'] },
    c: 0,
    x: { es: 'Tumbado con las piernas elevadas (sentado si le cuesta respirar), sin levantarse ni caminar, y siempre acompañado.',
         en: 'Lying down with legs raised (sitting if breathing is hard), not standing or walking, and never left alone.' } },

  { id: 'm4', tema: 'emergencia',
    q: { es: '¿A qué número llamas en España ante una emergencia médica?',
         en: 'Which number do you call in Spain for a medical emergency?' },
    o: { es: ['091', '010', '112', '016'], en: ['091', '010', '112', '016'] },
    c: 2,
    x: { es: 'El 112 es el número de emergencias en España y en toda la Unión Europea.',
         en: '112 is the emergency number in Spain and across the European Union.' } },

  { id: 'm5', tema: 'emergencia',
    q: { es: 'Tras usar el autoinyector, el cliente se siente mejor y quiere irse a casa.',
         en: 'After using the auto-injector, the guest feels better and wants to go home.' },
    o: { es: ['Le dejas marchar, ya está bien', 'Le cobras rápido y que descanse', 'Le dices que le tiene que ver un médico', 'Le ofreces un café para que se recupere'],
         en: ['Let them go, they are fine now', 'Bill them quickly so they can rest', 'Tell them a doctor must see them', 'Offer a coffee so they recover'] },
    c: 2,
    x: { es: 'La inyección no sustituye a la atención médica: tiene que verle un médico aunque se encuentre mejor.',
         en: 'The injection does not replace medical care: a doctor has to see them even if they feel better.' } },

  { id: 'm6', tema: 'emergencia',
    q: { es: 'Llamas al 112. ¿Qué es lo más útil que puedes decir?',
         en: 'You call 112. What is the most useful thing to say?' },
    o: { es: ['Solo el nombre del restaurante', 'Posible reacción alérgica grave y dirección', 'Que volverás a llamar más tarde si empeora', 'Que un cliente se ha mareado un poco'],
         en: ['Just the restaurant name', 'Possible severe allergic reaction and address', 'That you will call back later if it gets any worse', 'That a guest feels a bit dizzy'] },
    c: 1,
    x: { es: 'Di que puede ser una anafilaxia, qué ha comido, cómo está y la dirección exacta del local.',
         en: 'Say it may be anaphylaxis, what they ate, how they are and the exact address.' } },

  { id: 'm7', tema: 'emergencia',
    q: { es: 'Ya ha pasado todo. ¿Qué haces con lo que comió el cliente?',
         en: 'It is all over. What do you do with what the guest ate?' },
    o: { es: ['Lo tiras enseguida, por higiene', 'Nada, no hace falta contarlo', 'Se recoge la mesa como si nada', 'Lo guardas y apuntas qué comió'],
         en: ['Throw it away at once, for hygiene', 'Nothing, no need to report it', 'Clear the table as usual', 'Keep it and note what they ate'] },
    c: 3,
    x: { es: 'Saber exactamente qué comió ayuda al médico y a revisar con el encargado qué falló.',
         en: 'Knowing exactly what they ate helps the doctor and helps you review with the manager what went wrong.' } },
];
