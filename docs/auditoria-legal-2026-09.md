# Auditoría · compromiso de uso, pie legal y protección frente a reclamaciones

**Fecha:** 24 de septiembre de 2026 · **Base:** rama `claude/check-app-version-rDp39` sobre `301b171` · **Versión de la app:** 7.468 (sin subir todavía)

> **Esto no es asesoramiento jurídico.** Los textos son borradores redactados para que un abogado no parta de cero. Antes de darlos por definitivos, que los revise. Lo que sí está comprobado aquí es *lo técnico*: qué se guarda, dónde, quién puede tocarlo y qué pruebas lo sostienen.

---

## 1 · Qué había, y qué se ha hecho

**No se ha construido un mecanismo nuevo.** El repositorio ya tenía un compromiso de uso con firma por nombre y apellidos, montado y probado, **apagado** desde que el propietario paró «lo de las cláusulas y las firmas» (`data/nda.json`, `activo: false`, versión `2026-09-borrador-5-es`). Estaba completo de punta a punta:

| pieza | dónde | estado antes |
|---|---|---|
| Texto ES/EN, 7 cláusulas | `data/nda.json` | apagado |
| Pantalla de firma (tapa la app, input de nombre, validación) | `ndaMostrar` / `ndaFirmar` en `index.html` | montado |
| Puerta al entrar (contraseña **y** sesión de 90 días pasan por ella) | `closePinAndEnter` → `ndaPendiente` | montada |
| RPC `nda_sign` (`SECURITY DEFINER`): valida el nombre en servidor, guarda con IP y navegador, marca la cuenta | Supabase | activa, 0 firmas |
| Tabla `public.nda_signatures` (usuario, restaurante, nombre completo, versión, fecha, IP, user-agent) | Supabase | 0 filas |
| Re-firma automática cuando cambia la versión del texto | `ndaPendiente` compara `employees.nda_version` | montada |

**Lo hecho en esta rama:**

1. **Encendido y ampliado.** `activo: true`, versión `2026-09-24-v1`. De 7 cláusulas a **13**, en los dos idiomas, con paridad exigida por test. Contacto `contacto@meseo.es` en el texto.
2. **Pie de página del acceso** (`#loginFoot`): marca + tres columnas (Plataforma / Meseo / Legal) + dos avisos siempre visibles (formación ≠ fuente oficial de alérgenos; marcas de terceros) + © y correo. Traducido por tabla; un test exige que cada id del pie tenga traducción y viceversa.
3. **El compromiso se puede leer sin cuenta** desde el pie (`ndaVerTexto` → `ndaMostrar` en modo lectura). Es el **mismo fichero y la misma versión** que se firma: no hay dos textos.
4. **Aviso legal** (`showLegalModal` y su copia estática) reescrito con contacto, no-afiliación ampliada, «herramienta de formación, no fuente oficial», y enlace a la política completa.
5. **`privacidad.html`** actualizado: correo de empresa, fecha, la firma como dato tratado (con IP y navegador), los mensajes del chat y las fotos enviadas (**faltaban**, y existen en `chat_messages` y `dish_photo_submissions`), plazo de conservación de la firma (5 años, art. 1964 CC), sección «6 bis. Marcas y contenido de terceros».
6. **Alta de cuenta:** el texto de bienvenida avisa **antes** de crear la cuenta de que a la primera entrada se firmará con nombre y apellidos. Ver §4 sobre por qué no se añade un campo más.
7. **Tests:** 594 → 602. **Mutaciones:** NDA-1 (apagar), NDA-2 (EN pierde una cláusula), NDA-3 (privacidad vuelve al correo personal).
8. **SQL preparado, no aplicado:** `supabase/nda_signatures_solo_rpc.sql` (hallazgo H1).

---

## 2 · Mapa de protección: cada riesgo, dónde vive su respuesta

| riesgo | cláusula del compromiso | pie / aviso legal | privacidad.html | otro | fuerza |
|---|---|---|---|---|---|
| Un empleado le dice a un huésped que un plato es apto y no lo es | 3 «La última palabra la tiene cocina» | aviso N1 siempre visible + aviso legal | — | — | **alta** para acotar el papel de la app; **no** exime al restaurante de su obligación de información al cliente |
| Uso de nombres/marcas de restaurantes, chefs, bodegas | 5 «Marcas y nombres de otros» | aviso N2 + aviso legal | 6 bis | `docs/acuerdo-restaurante-borrador.md` | **media**: ver H4 — la firma del empleado **no** autoriza a Meseo a usar la marca del restaurante |
| Invasión de privacidad de compañeros/huéspedes (fotos, chat) | 6 «La privacidad de los demás» | — | filas chat y fotos | moderación por el responsable (fotos) | **media**: la prohibición está; el control a posteriori es humano |
| Datos de salud de huéspedes (alergias) en el chat | 6 | — | fila chat | — | **media** (art. 9 RGPD: es la categoría especial más probable aquí) |
| Uso de información privada / secretos del restaurante | 1 «Lo que ves aquí es del restaurante» | — | — | Ley 1/2019 secretos empresariales | **alta** frente al empleado |
| Copia de la app, extracción masiva, ingeniería inversa | 4 «La aplicación es de quien la hizo» + 7 «Uso correcto» | — | — | TRLPI | **alta** frente al empleado |
| Suplantación, acceso a cuentas ajenas, automatización | 7 «Uso correcto» + 2 «Tu cuenta es tuya» | — | — | rate-limits en servidor ya existentes | **alta** |
| Errores del contenido, caídas del servicio | 8 «Sin garantías, y hasta dónde llega la responsabilidad» | N1 | — | — | **media**: los límites de responsabilidad frente a quien no es consumidor son más sólidos; **revisar con abogado** el encaje con el ET si el empleado lo firma como trabajador del restaurante |
| Acusación de pacto de no competencia encubierto | 9 «Esto no te ata a ningún sitio» | — | — | ET art. 21.2 | **alta** |
| RGPD: información al interesado (art. 13) | 11 «Tus datos» + 12 «Tus derechos» | aviso legal | §1–6 | — | **alta** en información; ver H6 sobre la base jurídica |
| RGPD: prueba de que se informó y aceptó | 13 «La firma» | — | §1 fila «Firma» | `nda_signatures` con IP/UA/fecha/versión | **alta** técnicamente; ver H2 sobre el hash del texto |
| Retirada de acceso al dejar el restaurante | 10 «Acceso y cambios» | — | — | — | **media**: el texto lo dice; no hay proceso automático de baja |
| Menores | — | — | «no dirigida a menores de 14» | — | **baja**: no hay verificación de edad (H9) |

---

## 3 · Hallazgos

Severidad: **A** = arreglar antes de publicar · **M** = arreglar pronto · **B** = anotar.

### H1 · **[M]** `nda_signatures` era tocable desde la API
RLS activado **sin ninguna política**, y `anon`/`authenticated` con **todos** los privilegios (INSERT, SELECT, UPDATE, DELETE, **TRUNCATE**, REFERENCES, TRIGGER). Con RLS sin políticas, las operaciones por filas devuelven cero — pero `TRUNCATE` no pasa por RLS, y una tabla que es *prueba* no debería depender de que nadie le añada una política mal. **Preparado** `supabase/nda_signatures_solo_rpc.sql` (revoca todo; la RPC sigue escribiendo porque es `SECURITY DEFINER`). **No aplicado**: Supabase lo toca el propietario. Comprobación: los grants pasan de 14 filas a 0 y una firma de prueba por RPC sigue entrando.

### H2 · **[M]** La firma guarda la *versión* del texto, no el texto
`nda_signatures.nda_version = '2026-09-24-v1'`. Para reconstruir *qué* se firmó hay que ir al histórico de git de `data/nda.json`. Es reconstruible, pero la cadena de prueba sería más sólida guardando también un **hash SHA-256 de las cláusulas** en la firma. Cambio pequeño en `nda_sign` y en `supaNdaSign`; **no hecho** porque toca la RPC.

### H3 · **[B]** Sin red, no se firma
`ndaPendiente` devuelve `false` si el servidor no responde: alguien que entre por primera vez sin cobertura entra sin firmar, y se le pide a la siguiente entrada con red. Es una decisión de diseño heredada («dejar a alguien fuera de su formación por el wifi sería peor»). Documentada; no cambiada.

### H4 · **[A — decisión del propietario]** La firma del empleado no protege el uso de la marca del restaurante
Lo que firma el camarero acredita que **él** acepta cómo se usan los nombres. **No es una licencia del restaurante.** Si el titular de la marca objeta, lo que te cubre es (a) el uso meramente identificativo del art. 37 de la Ley de Marcas, reforzado por la no-afiliación que ahora está en tres sitios, y (b) el acuerdo con el restaurante de `docs/acuerdo-restaurante-borrador.md`, que **nadie ha firmado**. Con Txoko suspendido y M.B. en espera, hoy no hay ningún acuerdo firmado con ningún restaurante. Es el papel que falta.

### H5 · **[A]** Todo lo que se firma es borrador
Ninguno de los tres textos (compromiso, aviso legal, política) ha pasado por un abogado. Puntos que un abogado debería mirar primero: límite de responsabilidad (cl. 8) frente a alguien que firma como trabajador; base jurídica del tratamiento (H6); jurisdicción; si conviene un checkbox separado para el consentimiento de fotos.

### H6 · **[M]** Base jurídica declarada: interés legítimo del restaurante
`privacidad.html` §2 apoya el tratamiento en el interés legítimo del restaurante y en el consentimiento para lo opcional. Es defendible, pero la relación real es de **corresponsables** (Meseo + restaurante) y no consta documento de corresponsabilidad (art. 26 RGPD). Está apuntado también en el acuerdo con el restaurante (§10). Mientras no se firme, el eslabón débil es éste, no el del empleado.

### H7 · **[B]** Retención de 5 años sin mecanismo de purga
La política promete borrar la firma cinco años después de la baja de la cuenta. No existe ninguna tarea que lo haga, ni proceso de baja de cuenta que lo dispare. Se cumple a mano por ahora.

### H8 · **[B]** Todas las cuentas firmarán en su siguiente entrada — incluida la de administración
22 cuentas en `employees`, todas `venue=txoko`, ninguna con firma. Con la suspensión activa solo entran **Jenfry, Duvan, Dian y Administrador**: esas cuatro verán el compromiso primero. `Administrador` tiene `venue` (requisito de `nda_sign`), así que firma igual que las demás. Cuatro cuentas (Gabriel, María, Monica, Sheila) no tienen identidad de servidor; no afecta a la firma, que va por `name`.

### H9 · **[B]** No hay verificación de edad
La política dice «no dirigida a menores de 14». No se pide fecha de nacimiento ni se comprueba nada. Coherente con no pedir más datos (§4), pero que conste.

### H10 · **[corregido]** `privacidad.html` omitía tres tratamientos reales
Mensajes del chat (`chat_messages`, 15 filas), fotos de platos (`dish_photo_submissions`) y la propia firma. Ahora están.

### H11 · **[corregido]** El contacto RGPD era un correo personal
`duvandq@gmail.com` en la política y en el aviso. Ahora `contacto@meseo.es` en los cuatro sitios, con test y mutación que lo vigilan.

---

## 4 · Decisión: por qué NO se añade «nombre y apellidos» como campo del alta

Se pidió que el registro recogiese nombre y apellidos «e información necesaria que nos proteja». Se ha decidido **no añadir columnas nuevas**, y conviene que quede escrito el porqué:

1. **Ya se recoge, en el sitio correcto.** La primera entrada tras crear la cuenta pasa por `closePinAndEnter` → pantalla de firma → `nda_signatures.full_name`, con fecha, versión, IP y navegador. Ése es el registro con valor probatorio, y es **inmutable** (la RPC hace `on conflict do nothing`; con H1 aplicado, nadie más escribe).
2. **Guardarlo también en el alta lo duplicaría en un campo editable y visible.** El único sitio disponible sin migración es `display_name`, que el equipo ve en el ranking y el usuario puede cambiar en Ajustes. Un nombre legal ahí es peor prueba y más exposición.
3. **Más datos = más responsabilidad, no más protección.** DNI, dirección o teléfono no añaden fuerza a una firma electrónica simple y sí obligaciones de minimización, seguridad y retención. Lo que acredita la aceptación es *quién* (nombre completo + cuenta), *cuándo*, *qué texto* y *desde dónde*. Todo eso ya está.
4. **El alta está cerrada** mientras dure la suspensión (`SUSPENDIDA = true`). El aviso previo en la pantalla de alta queda listo para cuando se reabra.

Si aun así se quiere un campo `full_name` en `employees`, hace falta migración, cambio en `employee_register` y política de visibilidad. Se puede hacer; no se ha hecho sin que se decida.

---

## 5 · Lo que hay que probar en un iPhone antes de dar esto por bueno

1. Entrar con una cuenta real. Tiene que aparecer «Antes de entrar» encima de la app, con 13 cláusulas y el texto desplazable.
2. Escribir `asdf` y pulsar «He leído y firmo»: error, no entra.
3. Escribir nombre y apellidos reales y firmar: la pantalla se cierra y aparece Hoy.
4. En Supabase: `select employee, full_name, nda_version, ip from nda_signatures;` → una fila nueva.
5. Cerrar sesión y volver a entrar: **no** vuelve a pedir la firma.
6. En el login, bajar: el pie está debajo del formulario, en dos columnas, sin desplazamiento lateral. Tocar «Compromiso de uso»: se abre el mismo texto, con «Cerrar» y sin caja de firma. Tocar «Política de privacidad»: abre `privacidad.html`. Tocar «Aviso legal»: modal con el correo.
7. Cambiar a EN: el pie, el aviso y el compromiso cambian de idioma.
8. Modo avión + entrar con una cuenta que no haya firmado: entra sin firmar (H3). Volver a conectar y reentrar: pide la firma.

---

## 6 · Antes de publicar

- Subir versión (7.469) en los tres sitios: hoy sigue en 7.468 a propósito, porque la rama lleva además el arreglo del sticky (`301b171`) sin decidir.
- Aplicar `supabase/nda_signatures_solo_rpc.sql` (H1) y comprobar los grants.
- Decidir H4: el acuerdo con el restaurante es lo que de verdad falta.
- Pasar los tres textos por un abogado (H5).
