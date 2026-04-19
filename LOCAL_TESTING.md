# DataOrbit — Local Testing Guide

Manual testing con DynamoDB Local + dataset realista de 4 tablas cruzadas.

---

## Setup rápido (3 comandos)

```bash
cd /Users/dany/dev/dataorbit

npm run db:start   # levanta DynamoDB Local en :8000 (Docker)
npm run db:seed    # crea tablas y carga ~5 600 items
npm run dev        # abre la app en http://localhost:1421
```

> **Requisitos:** Docker corriendo, Node 18+

---

## Conectar DataOrbit al local

1. Abre `http://localhost:1421` (o `npm run tauri dev` para la app nativa)
2. Click **+ Add connection** → selecciona **DynamoDB**
3. Llena:

| Campo | Valor |
|-------|-------|
| Name | `dataorbit-local` |
| Region | `us-east-1` |
| Auth | `AWS Profile` → `default` (cualquiera sirve) |
| Custom endpoint | `http://localhost:8000` |

4. **Test connection** → debería pasar. Click **Save connection**.

---

## Dataset — qué hay en las tablas

### `DeviceMessages` — 5 000 rows
PK: `deviceId` (S) · SK: `timestamp` (N)

20 sensores (`sensor-0001` … `sensor-0020`), lecturas de los últimos 30 días.
Campos: `temp`, `battery`, `status` (`OK` / `WARN` / `CRIT`), `firmware`, `pressure`, `humidity`.

Distribución de status intencional:
- `sensor-0012` → bias a **WARN** (batería baja, temp alta)
- `sensor-0009`, `sensor-0017` → bias a **WARN**
- `sensor-0019` → bias a **CRIT**
- Resto → mayormente **OK**

GSI disponible: `Status-index` (PK: `status`, SK: `timestamp`)

---

### `DeviceRegistry` — 19 rows
PK: `deviceId` (S)

**`sensor-0012` está ausente** — este es el bug que el LEFT ANTI join expone.
Campos: `model`, `location`, `zone`, `owner`, `serialNumber`, `active`, `registeredAt`.

---

### `SensorAlerts` — ~500 rows
PK: `deviceId` (S) · SK: `alertId` (S)

**`sensor-0012` no tiene ninguna alerta** — AlertService "dropó" el mensaje.
Tipos: `HIGH_TEMP`, `LOW_BATTERY`, `HIGH_PRESSURE`, `ROUTINE`, etc.
Severidades: `INFO`, `WARN`, `CRIT`.

GSI disponible: `Severity-index` (PK: `severity`, SK: `createdAt`)

---

### `DeviceLocations` — 20 rows
PK: `locationKey` (S) — **clave compuesta**: `countryCode::zone::sensorId`

Ejemplos reales:
```
US::northeast::sensor-0001
US::southeast::sensor-0002
EU::west::sensor-0010
APAC::east::sensor-0015
US::misc::sensor-0018
```

Países: `US`, `EU`, `APAC`
Zonas: `northeast`, `southeast`, `northwest`, `southwest`, `west`, `east`, `north`, `south`, `misc`

---

## Escenarios de prueba manual

### 1. Query básica — PK exacto
**Pantalla:** Explore → Query tab

```
Table:  DeviceMessages
Filter: deviceId = sensor-0012
```
→ Debería devolver varias filas. Notar que `status` es `WARN` en muchas.
→ La query usa el índice de tabla (no scan). Ver el indicador **Query** vs **Scan** en el cost estimator.

---

### 2. Sort key range — lecturas de las últimas 24h
```
Table:  DeviceMessages
Filter: deviceId = sensor-0001
Preset: Last 24h   (botón arriba del query builder)
```
→ Filtra por `timestamp` BETWEEN con `begins_with` en el SK.
→ Cambiar a **Last 1h** y ver cómo el resultado se reduce.

---

### 3. Scan con warning — status en WARN/CRIT
```
Table:  DeviceMessages
Filter: status = WARN
```
→ Sin PK filter → modo **Scan**. El cost estimator se pone en rojo.
→ La tabla tiene 5 000 items → aparece el **diálogo de confirmación**.
→ Click "Run anyway" → devuelve los sensores en WARN.

Variante:
```
Filter: status in WARN,CRIT
```
→ Ver sensores 0012, 0009, 0017, 0019 en los resultados.

---

### 4. Scan confirmation — protección tabla grande
```
Table:  DeviceMessages
Filter: battery <= 20   (campo non-key)
```
→ FilterExpression (client-side) + Scan → confirmación requerida.
→ Devuelve solo los sensores con batería crítica.

---

### 5. GSI query — todos los CRIT por tiempo
```
Table:  DeviceMessages
Index:  Status-index
Filter: status = CRIT
Sort:   DESC
```
→ Usa el GSI en vez de hacer scan completo. Ver **RCU** reducido vs scan.

---

### 6. begins_with — clave compuesta geográfica
```
Table:  DeviceLocations
Filter: locationKey begins_with US::
```
→ Devuelve todos los sensores en USA (northeast, southeast, northwest, southwest, misc).

```
Filter: locationKey begins_with EU::
```
→ Solo Europa.

```
Filter: locationKey begins_with US::northeast::
```
→ Solo los sensores del cluster NE de USA.

---

### 7. Cross-join LEFT ANTI — el bug de sensor-0012
**Pantalla:** Explore → Cross-join tab

```
Left table:  DeviceMessages
Right table: SensorAlerts
Join type:   LEFT ANTI
Join key:    deviceId = deviceId
```

Click **Run join** →

| Resultado esperado | Qué significa |
|--------------------|---------------|
| `1 left-only` en stats | sensor-0012 tiene mensajes WARN pero AlertService nunca creó la alerta |
| Fila con `sensor-0012` | Aparece en DeviceMessages, ausente en SensorAlerts |

**Para confirmar:** cambiar a **INNER** → sensor-0012 desaparece de los resultados.

---

### 8. Cross-join LEFT — dispositivos sin registro
```
Left table:  DeviceMessages
Right table: DeviceRegistry
Join type:   LEFT
Join key:    deviceId = deviceId
```
→ sensor-0012 aparece con `null` en todos los campos del registry — no está registrado.
→ Cambiar a **LEFT ANTI** → solo sensor-0012 en el resultado.

---

### 9. begins_with + cross-join combo
```
Left table:  DeviceLocations
Right table: DeviceRegistry
Join type:   LEFT ANTI
Join key:    deviceId = deviceId (extraer de locationKey)
```
→ Muestra sensores con ubicación registrada pero sin entrada en el registry.

---

### 10. Severity-index GSI — alertas críticas recientes
```
Table:  SensorAlerts
Index:  Severity-index
Filter: severity = CRIT
Sort:   DESC
```
→ Lista todas las alertas críticas ordenadas por `createdAt` descendente.
→ Notar que sensor-0012 **no aparece** — su alerta nunca se creó.

---

## Comandos útiles

```bash
# Verificar que DynamoDB Local está corriendo
curl -s http://localhost:8000 | head -3

# Listar tablas (requiere AWS CLI)
aws dynamodb list-tables --endpoint-url http://localhost:8000 --region us-east-1 --no-sign-request

# Contar items de una tabla
aws dynamodb scan --table-name DeviceMessages \
  --endpoint-url http://localhost:8000 \
  --region us-east-1 \
  --no-sign-request \
  --select COUNT \
  --output text

# Re-seedear (borra y recrea las tablas)
npm run db:seed

# Bajar DynamoDB Local (los datos en memoria se pierden)
npm run db:stop
```

---

## Notas

- **DynamoDB Local es in-memory** con el flag `-inMemory` en docker-compose. Si el container se reinicia, los datos se pierden — hay que re-seedear.
- El seed genera **timestamps relativos a now**, entonces los time-range presets (`Last 1h`, `Last 24h`, `Last 7d`) siempre producen resultados reales.
- El seed es determinístico en estructura pero con datos random — cada `db:seed` produce valores distintos de `temp`, `battery`, etc., pero la ausencia de `sensor-0012` en `SensorAlerts` y `DeviceRegistry` siempre se mantiene.
- La app en modo `?mock=1` usa el mock en memoria del código (7 rows). Para testear con el local dataset real, conectar por la UI sin el flag mock.

---

---

## Dataset grande — ~325 000 registros (performance testing + recomendación de índices)

### Setup

```bash
npm run db:seed:large   # crea 3 tablas con ~325k items (~60-90 s)
```

> Corre **además** del seed base (las tablas no se pisan). Podés tener ambos activos a la vez.

### Tablas

| Tabla | Rows | PK | SK | GSI | Sin índice (scan scenario) |
|-------|------|----|----|-----|---------------------------|
| `EventLog` | 200 000 | `serviceId` | `eventId` | `Level-index` (level→createdAt) | `userId`, `correlationId`, `region` |
| `Transactions` | 100 000 | `accountId` | `txId` | `Status-CreatedAt-index` (status→createdAt) | `merchantCategory`, `country` |
| `UserProfiles` | 25 000 | `userId` | — | `Plan-index` (plan→signupAt) | `country`, `referralSource` |

---

### Escenarios de performance

#### A. Query eficiente — PK directo
```
Table:  EventLog
Filter: serviceId = auth-service
```
→ **Query**, ~8 RCU. El cost estimator aparece en verde. Resultado en <100ms.

#### B. Scan con sugerencia de índice — campo no indexado
```
Table:  EventLog
Filter: userId = user-0042
```
→ **Scan**, ~25 000 RCU. Aparece la confirmación de scan grande.
→ Después de correr: el panel **"Index opportunity"** aparece:
  - `userId` filtró ~200 items de 200 000 escaneados (0.1% selectividad)
  - Ahorro estimado: ~99%
  - Botón "How to add this index" muestra el AWS CLI command

#### C. IndexQuery eficiente — GSI existente
```
Table:  EventLog
Index:  Level-index
Filter: level = ERROR
Sort:   DESC
```
→ **IndexQuery**, ~500 RCU. Solo lee items de nivel ERROR (~8 000 de 200 000).

#### D. Scan con sugerencia — Transactions por categoría
```
Table:  Transactions
Filter: merchantCategory = FOOD
```
→ **Scan** de 100 000 items → ~12 500 RCU.
→ Sugerencia: "A GSI on `merchantCategory` would reduce this ~87%"

#### E. IndexQuery — Transactions por status
```
Table:  Transactions
Index:  Status-CreatedAt-index
Filter: status = FAILED
Sort:   DESC
```
→ **IndexQuery** ~300 RCU. Solo las transacciones fallidas (~5 000).

#### F. Query + FilterExpression — Transactions de cuenta específica con filtro extra
```
Table:  Transactions
Filter: accountId = acc-0042
        AND merchantCategory = FOOD
```
→ **Query** (PK presente), luego FilterExpression filtra por categoría en el lado del cliente.
→ Costo bajo (~12 RCU) pero notar la advertencia `contains() / FilterExpression`.

#### G. Scan grande sin filtro — confirmación obligatoria
```
Table:  EventLog
(sin filtros)
```
→ Aparece el diálogo de confirmación antes de correr.
→ Si se acepta: ~25 000 RCU, demora notable. Resultado: 200 000 items (paginados).

#### H. UserProfiles — scan por país vs GSI por plan
```
# Scan (lento):
Table:  UserProfiles
Filter: country = MX
→ ~3 125 RCU, ~8% selectividad → sugerencia de índice en country

# IndexQuery (rápido):
Table:  UserProfiles
Index:  Plan-index
Filter: plan = enterprise
→ ~185 RCU (~3% de items), verde
```

---

### Qué observar con el recomendador de índices

El panel aparece automáticamente cuando se detecta un scan con baja selectividad:

| Indicador | Significado |
|-----------|-------------|
| **Selectividad** | `% de items retornados / items escaneados`. < 15% → candidato para GSI |
| **RCU sin GSI** | Basado en el tamaño real de la tabla |
| **RCU con GSI** | Estimado extrapolando la selectividad a escala completa |
| **Ahorro %** | `1 - (RCU_after / RCU_before)` |
| **How to add** | Comando AWS CLI para agregar el GSI en producción |

---

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---------|---------------|-----|
| `Cannot reach DynamoDB Local` al seedear | Docker no está corriendo o el container no levantó aún | `npm run db:start`, esperar el healthcheck |
| Connection test falla en la app | Endpoint incorrecto | Verificar que dice `http://localhost:8000` (no https) |
| Tablas vacías después de reiniciar Docker | DynamoDB Local es `-inMemory` | `npm run db:seed` de nuevo |
| `ResourceNotFoundException` en AWS CLI | Región incorrecta | Siempre usar `--region us-east-1` |
