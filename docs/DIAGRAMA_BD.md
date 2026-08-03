# Diagrama de base de datos

```mermaid
erDiagram
    USERS ||--o{ JOBS : crea_actualiza
    USERS ||--o{ HISTORY_EVENTS : ejecuta
    USERS ||--o{ CUT_ORDERS : crea
    USERS ||--o{ PRINT_LOGS : imprime
    USERS ||--o{ LOGIN_ATTEMPTS : intenta
    USERS ||--o{ DOCUMENTS : sube
    JOBS ||--o{ JOB_ROOMS : contiene
    JOBS ||--o{ HISTORY_EVENTS : audita
    JOBS ||--o{ CUT_ORDERS : revisiones
    JOBS ||--o{ DOCUMENTS : adjunta
    CUT_ORDERS ||--o{ CUT_ORDER_ITEMS : congela
    CUT_ORDERS ||--o{ PRINT_LOGS : registra

    USERS {
      string id PK
      string username UK
      string role
      json permissions_json
      boolean active
      integer auth_version
    }
    JOBS {
      string id PK
      string name
      string status
      json state_json
      integer version
      timestamptz deleted_at
      timestamptz locked_at
    }
    JOB_ROOMS {
      string id PK
      string job_id FK
      string source_id
      string room_code
      numeric width_m
      numeric height_m
      numeric gather
      numeric hem_m
      smallint sheets
      string opening
    }
    HISTORY_EVENTS {
      string id PK
      string job_id FK
      string user_id FK
      string action
      string entity_type
      json before_json
      json after_json
      string ip_address
      string request_id
    }
    CUT_ORDERS {
      string id PK
      string order_number UK
      string job_id FK
      integer revision
      string status
      json snapshot_json
      boolean is_current
    }
    CUT_ORDER_ITEMS {
      string id PK
      string order_id FK
      string room_code
      numeric width_m
      numeric height_m
      numeric measure_per_sheet_m
      numeric fabric_m
    }
    PRINT_LOGS {
      string id PK
      string order_id FK
      string user_id FK
      string document_type
      boolean is_reprint
      timestamptz created_at
    }
    LOGIN_ATTEMPTS {
      string id PK
      string username
      string ip_address
      boolean successful
      timestamptz created_at
    }
    DOCUMENTS {
      string id PK
      string job_id FK
      string storage_key UK
      string sha256
      integer size_bytes
    }
```

Las FK de órdenes e ítems usan `RESTRICT` para preservar trazabilidad; las habitaciones del trabajo usan `CASCADE`; auditoría/usuarios usan `SET NULL` donde debe conservarse el evento.
