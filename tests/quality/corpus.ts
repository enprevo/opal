/**
 * Realistic mixed Italian/English document collection for measuring semantic search quality.
 * Several documents bury the relevant fact deep inside a long text; distractors (code, data,
 * logs, config, licences, duplicate readmes) must never outrank the real documents.
 */

const lorem = (topic: string, n: number): string =>
  Array.from({ length: n }, (_, i) => `${topic} — sezione ${i + 1}. Questa parte riporta dettagli generali, riferimenti, note e allegati che non cambiano il senso del documento.`).join('\n')

export const DOCS: Record<string, string> = {
  'Fatture/Fattura_2024_017_TermoService.txt': `TERMOSERVICE S.R.L. — Assistenza impianti termici
Via dei Mille 22, 20100 Milano — P.IVA 01234567890

FATTURA N. 17/2024 del 14/02/2024
Cliente: Enrico P., Via Verdi 5, Monza

Descrizione intervento:
- Manutenzione ordinaria caldaia a condensazione Vaillant ecoTEC plus
- Pulizia scambiatore e bruciatore, controllo fumi (analisi combustione)
- Sostituzione guarnizione camera stagna
- Compilazione libretto di impianto

Imponibile: € 180,00
IVA 22%: € 39,60
Totale da pagare: € 219,60
Pagamento: bonifico bancario entro 30 giorni. IBAN IT60 X054 2811 1010 0000 0123 456.`,

  'Casa/Contratto_locazione_via_Roma.txt': `CONTRATTO DI LOCAZIONE AD USO ABITATIVO (L. 431/1998, art. 2 comma 1)
Tra il sig. Mario Bianchi (locatore) e il sig. Enrico P. (conduttore) si conviene e stipula quanto segue.
Art. 1 — Oggetto. Il locatore concede in locazione l'unità immobiliare sita in Milano, via Roma 12, piano terzo, composta da tre vani più servizi, cantina e posto auto.
Art. 2 — Durata. Il contratto ha durata di anni quattro, dal 1 marzo 2023 al 28 febbraio 2027, e si rinnova automaticamente per altri quattro anni salvo disdetta.
Art. 3 — Canone. Il canone annuo è stabilito in euro 13.200, da pagarsi in rate mensili anticipate di euro 1.100 entro il giorno 5 di ogni mese.
${lorem('Condizioni generali di locazione', 10)}
Art. 7 — Deposito cauzionale. A garanzia degli obblighi assunti il conduttore versa al locatore la somma di euro 3.300, pari a tre mensilità del canone, non imputabile in conto pigioni. Il deposito sarà restituito al termine della locazione, maggiorato degli interessi legali, previa verifica dello stato dell'immobile.
Art. 8 — Spese accessorie. Sono a carico del conduttore le spese condominiali ordinarie, il riscaldamento centralizzato e la tassa rifiuti.
${lorem('Clausole finali', 6)}`,

  'Ricette/torta_di_mele_della_nonna.md': `# Torta di mele della nonna

Ingredienti: 3 mele renette, 250 g di farina, 150 g di zucchero, 3 uova, 100 g di burro fuso, una bustina di lievito, la scorza di un limone, un cucchiaino di cannella.

1. Sbattere le uova con lo zucchero finché il composto è chiaro e spumoso.
2. Aggiungere il burro fuso, la scorza di limone e la farina setacciata con il lievito.
3. Sbucciare le mele, tagliarle a fettine sottili e unirne metà all'impasto.
4. Versare in una tortiera da 24 cm, decorare con le fettine rimaste e spolverare di cannella e zucchero di canna.
5. Cuocere in forno statico a 180 °C per 45 minuti.`,

  'Ricette/lasagne_alla_bolognese.md': `# Lasagne alla bolognese

Per il ragù: 300 g di macinato di manzo, 200 g di salsiccia, sedano, carota, cipolla, un bicchiere di vino rosso, 700 g di passata di pomodoro. Cuocere a fuoco lento per almeno due ore.
Per la besciamella: 1 litro di latte, 80 g di burro, 80 g di farina, noce moscata.
Alternare strati di sfoglia all'uovo, ragù, besciamella e parmigiano. Infornare a 200 °C per 30 minuti e lasciare riposare prima di servire.`,

  'Lavoro/Riunioni/meeting_2024-03-12_budget.md': `# Leadership meeting — 12 March 2024

Attendees: Laura (CFO), Marco (Sales), Giulia (Marketing), Enrico (Engineering)

## Q2 budget
- Revenue forecast for Q2 lowered by 8% after the delay of the Acme contract.
- Laura proposed freezing new hires until July; approved.
- Giulia agreed to cut the paid marketing spend by 20% and move the trade-show money to webinars.
- Engineering keeps its budget, but cloud costs must drop by 15% (Enrico to review reserved instances).

## Action items
- Marco: renegotiate payment terms with the three largest customers.
- Laura: circulate the revised budget spreadsheet by Friday.`,

  'Lavoro/Clienti/Offerta_Rossi_gestionale.txt': `Spett.le Rossi Arredamenti S.p.A.
Oggetto: offerta per lo sviluppo del nuovo gestionale magazzino e ordini

Facendo seguito all'incontro del 3 aprile, siamo lieti di sottoporvi la nostra proposta.
Fase 1 — Analisi dei requisiti e prototipo delle schermate: 15 giorni/uomo.
Fase 2 — Sviluppo del gestionale web (anagrafiche, ordini, giacenze, DDT, integrazione con il vostro ERP): 60 giorni/uomo.
Fase 3 — Collaudo, formazione del personale e avviamento: 10 giorni/uomo.
Prezzo complessivo a corpo: € 12.500 + IVA, pagabili 30% all'ordine, 40% al rilascio, 30% al collaudo.
Validità dell'offerta: 60 giorni.`,

  'Viaggi/Giappone_2024/itinerario.md': `# Giappone — aprile 2024

Giorno 1-4: Tokyo. Hotel Gracery Shinjuku. Visite: Asakusa, Shibuya, Harajuku, museo Ghibli (biglietti già comprati per il giorno 3 alle 14:00).
Giorno 5: Hakone, ryokan con onsen, vista sul monte Fuji se il tempo lo permette.
Giorno 6-9: Kyoto. Fushimi Inari all'alba, Kinkaku-ji, Arashiyama e il bosco di bambù, Gion la sera.
Giorno 10: Nara, i cervi e il Todai-ji.
${lorem('Note di viaggio', 6)}
Giorno 11-13: Osaka. Dormiamo all'hotel Cross Osaka a Dotonbori, check-in dalle 15. Street food a Kuromon Market, castello di Osaka, Universal Studios il giorno 12.
Rientro dal Kansai International Airport il giorno 14, volo alle 11:25.`,

  'Viaggi/Biglietto_Frecciarossa_Milano_Roma.txt': `Trenitalia — Biglietto elettronico
Frecciarossa 9531 Milano Centrale 07:00 → Roma Termini 10:10
Data di viaggio: 22/05/2024 — Carrozza 5, posto 7A, livello Business
Passeggero: Enrico P. — Codice PNR: XK7P2Q — Importo: € 89,90
Il biglietto è valido solo per il treno, la data e l'ora indicati.`,

  'Salute/Referto_analisi_sangue_2024.txt': `LABORATORIO ANALISI SAN RAFFAELE — Referto
Paziente: Enrico P. Data prelievo: 08/01/2024
Emocromo: nella norma.
Glicemia: 92 mg/dL (70-100)
Colesterolo totale: 238 mg/dL (valori desiderabili < 200) — ALTO
Colesterolo HDL: 52 mg/dL
Colesterolo LDL: 161 mg/dL (< 130) — ALTO
Trigliceridi: 125 mg/dL
Note del medico: ridurre grassi saturi, attività fisica regolare, ricontrollo tra sei mesi.`,

  'Auto/Polizza_RCA_2024.txt': `Compagnia Assicurativa Sicura — Polizza RC Auto n. 55/889123
Contraente: Enrico P. Veicolo: Volkswagen Golf targa GH 123 ZK
Garanzie: Responsabilità civile massimale € 10.000.000, furto e incendio, assistenza stradale, cristalli.
Decorrenza: 15/06/2024 ore 24:00 — Scadenza: 15/06/2025 ore 24:00
Premio annuo: € 612,00 — Classe di merito CU 1.
In caso di sinistro chiamare il numero verde 800 123 456.`,

  'Auto/Tagliando_officina_marzo.txt': `Officina Meccanica F.lli Conti — Ricevuta lavori
Veicolo VW Golf GH 123 ZK, km 61.240
Lavori eseguiti: tagliando completo con sostituzione olio motore 5W-30, filtro olio, filtro aria, filtro abitacolo; controllo freni e livelli; rotazione pneumatici.
Totale: € 285,00. Prossimo tagliando previsto a 76.000 km o entro un anno.`,

  'Tech/STM32WBA_BLE_workshop_notes.md': `# STM32WBA workshop — personal notes

The STM32WBA5x is a wireless MCU with a Cortex-M33 and a Bluetooth Low Energy 5.3 radio.
${lorem('Product overview', 5)}
## Hands-on 2: build a BLE peripheral
1. In STM32CubeMX start from the STM32WBA chipset and enable the STM32_WPAN middleware.
2. Select the P2P Server profile so the board advertises as a discoverable peripheral.
3. Generate the code, build it with STM32CubeIDE and flash the Nucleo board.
4. Connect from the ST BLE Toolbox app on the phone and toggle the LED through the custom GATT characteristic.
## Certification
Use the RF test mode (Transparent Mode over UART) to prepare radio certification with your own hardware design.`,

  'Tech/LSM6DSOX_machine_learning_core.md': `# LSM6DSOX — Machine Learning Core

The LSM6DSOX inertial module embeds a Machine Learning Core (MLC) that runs decision trees directly in the sensor, so the host MCU can sleep.
Example: tilt / inclination detection. Accelerometer data at 26 Hz is filtered, features such as mean and variance on each axis are computed over a 2-second window, and a decision tree classifies the board as horizontal, vertical or tilted.
The tree is trained with the Unico GUI or the Python scripts from logs of each position, then exported as a register configuration (.ucf) and loaded at boot.`,

  'Tech/Guida_backup_NAS_Synology.md': `# Come fare il backup del NAS Synology

1. Installare Hyper Backup dal Centro pacchetti.
2. Creare una nuova attività di backup dei dati scegliendo come destinazione un disco USB esterno oppure un cloud (Synology C2, Backblaze B2).
3. Selezionare le cartelle condivise da salvare: foto, documenti, home degli utenti.
4. Pianificare il backup ogni notte alle 2:00 e attivare la rotazione delle versioni (Smart Recycle, 30 versioni).
5. Abilitare la cifratura lato client e conservare la chiave in un posto sicuro.
6. Una volta al mese verificare il ripristino di qualche file con Hyper Backup Explorer.`,

  'Tech/server_migration_plan.md': `# Server migration plan

Goal: move the on-premise application server and the SQL Server database to Microsoft Azure by the end of Q3.
Phase 1: inventory of services, dependencies and firewall rules.
Phase 2: lift-and-shift of the web tier to Azure App Service; database to Azure SQL Managed Instance using the Data Migration Service.
Phase 3: cut-over during a planned downtime window on Saturday night (22:00-04:00), DNS TTL lowered to 5 minutes the week before.
Rollback: keep the old servers running read-only for two weeks.`,

  'Personale/Lettera_dimissioni.txt': `Spett.le Alfa Consulting S.r.l., alla c.a. dell'Ufficio Personale
Oggetto: dimissioni volontarie

Con la presente comunico la mia decisione di rassegnare le dimissioni dal ruolo di Software Engineer, nel rispetto del periodo di preavviso di 30 giorni previsto dal CCNL. L'ultimo giorno di lavoro sarà quindi il 30 settembre 2024.
Ringrazio l'azienda e i colleghi per gli anni di collaborazione.
Distinti saluti, Enrico P.`,

  'Personale/CV_Enrico_P_EN.md': `# Enrico P. — Embedded & Software Engineer

Experience
- 2019–today: Lead firmware engineer, IoT sensors (STM32, BLE, LoRa), cloud dashboards.
- 2014–2019: Software developer, industrial automation and HMI.
Education: MSc Electronic Engineering, Politecnico di Milano.
Skills: C/C++, Rust, TypeScript, Python, Zephyr, FreeRTOS, Azure IoT.
Languages: Italian (native), English (fluent).`,

  'Famiglia/Iscrizione_scuola_primaria.txt': `Istituto Comprensivo G. Rodari — Domanda di iscrizione alla scuola primaria a.s. 2024/25
Alunno: Luca P., nato il 12/03/2018.
Tempo scuola scelto: 40 ore settimanali (tempo pieno).
Servizio mensa: richiesto. Costo del buono pasto € 4,80; esonero parziale in base all'ISEE.
Pre-scuola dalle 7:30: richiesto. Documenti da allegare: certificato vaccinale, codice fiscale dei genitori.`,

  'Tasse/730_2024_promemoria.txt': `Promemoria dichiarazione dei redditi 730/2024
Spese detraibili al 19%: spese mediche e farmaci (scontrini parlanti con codice fiscale) oltre la franchigia di € 129,11; interessi del mutuo prima casa; spese veterinarie; attività sportive dei figli.
Detrazioni 50%: ristrutturazione bagno (bonifici parlanti).
Da recuperare: certificazione interessi mutuo dalla banca, fatture dentista, ricevute palestra di Luca.
Scadenza invio: 30 settembre.`,

  'Casa/Condominio/Verbale_assemblea_2024.txt': `Condominio Via Roma 12 — Verbale dell'assemblea straordinaria del 10/04/2024
Presenti 14 condomini su 18, pari a 812 millesimi.
Punto 1: rifacimento della facciata e dei balconi. L'assemblea approva il preventivo della ditta Edilnord per € 148.000 con 640 millesimi favorevoli. I lavori inizieranno a giugno; ripartizione per millesimi di proprietà, pagamento in 4 rate.
Punto 2: sostituzione del portone d'ingresso, rinviata.
Punto 3: nomina del nuovo amministratore, confermato il dott. Ferri.`,

  'Lavoro/Legale/NDA_Acme_Corp.txt': `MUTUAL NON-DISCLOSURE AGREEMENT
This Agreement is entered into by Acme Corp. and Alfa Consulting S.r.l. to protect confidential information exchanged while evaluating a possible collaboration on industrial sensors.
1. Confidential Information includes technical data, source code, designs, prices and business plans.
2. The receiving party shall not disclose Confidential Information to third parties and shall use it only for the stated purpose.
3. Obligations survive for five (5) years after termination. Governing law: Italy, court of Milan.`,

  'Hobby/DJI_Mini_manual_excerpt.txt': `DJI Mini — user manual (excerpt)
${lorem('Safety', 4)}
Compass calibration: calibrate the compass when prompted by the app or after flying far from the last calibration point. Stand away from metal objects, tap Calibrate in DJI Fly, rotate the aircraft horizontally 360° until the indicator turns green, then hold it vertically nose down and rotate again.
Battery: store intelligent flight batteries at 40–60% charge; the battery self-discharges to storage level after 10 days.`,

  'Finanze/Simulazione_mutuo_banca.txt': `Simulazione mutuo prima casa — Banca Popolare
Importo richiesto: € 220.000 — Valore immobile: € 310.000 — Durata: 25 anni
Tasso fisso nominale annuo (TAN): 3,20% — TAEG: 3,45%
Rata mensile: € 1.066,00
Spese di istruttoria € 1.000, perizia € 300, imposta sostitutiva 0,25%.
Offerta valida fino al 31/05/2024.`,

  'Lavoro/Marketing/Opal_pitch.md': `# Opal — pitch

Opal is a fast dual-pane file manager for Windows, macOS and Linux. It finds documents by meaning, previews any file with the space bar and lets power users script everything with a small command language.
Target: developers, photographers and office workers who juggle many folders every day.
Pricing: free and open source; optional sponsor tier.`,

  'Giardino/Potatura_ulivi.md': `# Potatura degli ulivi

Il periodo migliore va da fine febbraio ad aprile, dopo le gelate e prima della fioritura.
Si eliminano i polloni alla base, i rami secchi e quelli che crescono verso l'interno, per far entrare luce e aria nella chioma (forma a vaso policonico).
Non togliere più di un terzo della vegetazione in un anno; disinfettare le forbici e coprire i tagli grandi con mastice.`,

  'Animali/Libretto_vaccini_Fido.txt': `Ambulatorio Veterinario Le Querce — Libretto sanitario
Cane: Fido, meticcio, maschio, microchip 380260000123456
Vaccinazioni: cimurro, epatite, parvovirosi (richiamo triennale, ultimo 05/2023); leptospirosi (richiamo annuale, ultimo 04/2024); antirabbica 04/2024 per i viaggi all'estero.
Prossimo controllo: aprile 2025. Antiparassitario mensile da marzo a novembre.`,

  // ---------------------------------------------------------------- distractors
  'Code/drivers/lsm6dsox_reg.c': `/* lsm6dsox_reg.c - register driver */
#include "lsm6dsox_reg.h"
int32_t lsm6dsox_read_reg(stmdev_ctx_t *ctx, uint8_t reg, uint8_t *data, uint16_t len) {
  int32_t ret;
  ret = ctx->read_reg(ctx->handle, reg, data, len);
  return ret;
}
int32_t lsm6dsox_xl_data_rate_set(stmdev_ctx_t *ctx, lsm6dsox_odr_xl_t val) {
  lsm6dsox_ctrl1_xl_t ctrl1_xl;
  int32_t ret = lsm6dsox_read_reg(ctx, LSM6DSOX_CTRL1_XL, (uint8_t *)&ctrl1_xl, 1);
  if (ret == 0) { ctrl1_xl.odr_xl = (uint8_t)val; ret = lsm6dsox_write_reg(ctx, LSM6DSOX_CTRL1_XL, (uint8_t *)&ctrl1_xl, 1); }
  return ret;
}`,
  'Code/app/main.py': `import sys, json\n\ndef main():\n    cfg = json.load(open(sys.argv[1]))\n    for k, v in cfg.items():\n        print(k, v)\n\nif __name__ == "__main__":\n    main()\n`,
  'Data/sensor_log_2024.csv': Array.from({ length: 120 }, (_, i) => `${i},${(Math.sin(i) * 1000).toFixed(2)},${(Math.cos(i) * 980).toFixed(2)},${(i * 3.7).toFixed(1)}`).join('\n'),
  'Data/tilt_session.txt': Array.from({ length: 80 }, (_, i) => `${(i * 0.038).toFixed(3)}\t${(Math.sin(i / 7) * 0.98).toFixed(4)}\t${(Math.cos(i / 9) * 0.12).toFixed(4)}\t${(0.01 * i).toFixed(4)}`).join('\n'),
  'Logs/app.log': Array.from({ length: 60 }, (_, i) => `2024-03-0${(i % 9) + 1} 10:${String(i).padStart(2, '0')}:12 INFO  [worker-${i % 4}] job ${1000 + i} completed in ${i * 13} ms`).join('\n'),
  'Config/settings.ini': `[general]\nlanguage=it\ntheme=dark\n[network]\nproxy=\ntimeout=30\n[paths]\ndata=C:/data\n`,
  'Tools/teraterm-4.106/readme.txt': `Tera Term is a free terminal emulator for Windows. It supports serial port connections, SSH and Telnet, macros and file transfer with XMODEM, YMODEM and ZMODEM.\nInstallation: unzip the archive and run ttermpro.exe.`,
  'Workshop/Tools/teraterm-4.106/readme.txt': `Tera Term is a free terminal emulator for Windows. It supports serial port connections, SSH and Telnet, macros and file transfer with XMODEM, YMODEM and ZMODEM.\nInstallation: unzip the archive and run ttermpro.exe.`,
  'Licenses/LICENSE.txt': `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`
}

export interface QualityQuery {
  q: string
  /** Acceptable answers (any of them counts). Empty = nothing relevant exists. */
  expect: string[]
}

export const QUERIES: QualityQuery[] = [
  { q: 'invoice for the boiler repair', expect: ['Fatture/Fattura_2024_017_TermoService.txt'] },
  { q: 'quanto ho pagato il tecnico della caldaia', expect: ['Fatture/Fattura_2024_017_TermoService.txt'] },
  { q: 'how much is the security deposit for the flat', expect: ['Casa/Contratto_locazione_via_Roma.txt'] },
  { q: "contratto d'affitto dell'appartamento", expect: ['Casa/Contratto_locazione_via_Roma.txt'] },
  // The answer sits deep inside a long passage of a long contract, in another language.
  { q: 'how much is the deposit for the flat?', expect: ['Casa/Contratto_locazione_via_Roma.txt'] },
  { q: 'apple cake recipe', expect: ['Ricette/torta_di_mele_della_nonna.md'] },
  { q: 'pasta al forno con il ragù', expect: ['Ricette/lasagne_alla_bolognese.md'] },
  { q: 'riunione sul budget del secondo trimestre', expect: ['Lavoro/Riunioni/meeting_2024-03-12_budget.md'] },
  { q: 'who agreed to cut marketing spending', expect: ['Lavoro/Riunioni/meeting_2024-03-12_budget.md'] },
  { q: 'quote for developing the warehouse management software', expect: ['Lavoro/Clienti/Offerta_Rossi_gestionale.txt'] },
  { q: 'where do we sleep in Osaka', expect: ['Viaggi/Giappone_2024/itinerario.md'] },
  { q: 'trip to Kyoto', expect: ['Viaggi/Giappone_2024/itinerario.md'] },
  { q: 'train ticket to Rome', expect: ['Viaggi/Biglietto_Frecciarossa_Milano_Roma.txt'] },
  { q: 'cholesterol blood test results', expect: ['Salute/Referto_analisi_sangue_2024.txt'] },
  { q: "quando scade l'assicurazione della macchina", expect: ['Auto/Polizza_RCA_2024.txt'] },
  { q: 'car oil change', expect: ['Auto/Tagliando_officina_marzo.txt'] },
  { q: 'come creare una periferica bluetooth low energy', expect: ['Tech/STM32WBA_BLE_workshop_notes.md'] },
  { q: 'detect the inclination of the board with the accelerometer', expect: ['Tech/LSM6DSOX_machine_learning_core.md'] },
  { q: 'how to back up the NAS', expect: ['Tech/Guida_backup_NAS_Synology.md'] },
  { q: 'piano di migrazione dei server nel cloud', expect: ['Tech/server_migration_plan.md'] },
  { q: 'resignation letter', expect: ['Personale/Lettera_dimissioni.txt'] },
  { q: 'il mio curriculum vitae', expect: ['Personale/CV_Enrico_P_EN.md'] },
  { q: 'school canteen cost', expect: ['Famiglia/Iscrizione_scuola_primaria.txt'] },
  { q: 'tax deductions for medical expenses', expect: ['Tasse/730_2024_promemoria.txt'] },
  { q: 'facade renovation approved by the building assembly', expect: ['Casa/Condominio/Verbale_assemblea_2024.txt'] },
  { q: 'accordo di riservatezza', expect: ['Lavoro/Legale/NDA_Acme_Corp.txt'] },
  { q: 'calibrare la bussola del drone', expect: ['Hobby/DJI_Mini_manual_excerpt.txt'] },
  { q: 'mortgage interest rate', expect: ['Finanze/Simulazione_mutuo_banca.txt'] },
  { q: 'quando potare gli olivi', expect: ['Giardino/Potatura_ulivi.md'] },
  { q: 'dog vaccinations', expect: ['Animali/Libretto_vaccini_Fido.txt'] },
  { q: 'terminal emulator for the serial port', expect: ['Tools/teraterm-4.106/readme.txt', 'Workshop/Tools/teraterm-4.106/readme.txt'] },
  { q: 'Frecciarossa', expect: ['Viaggi/Biglietto_Frecciarossa_Milano_Roma.txt'] },
  { q: 'LSM6DSOX', expect: ['Tech/LSM6DSOX_machine_learning_core.md', 'Code/drivers/lsm6dsox_reg.c'] },
  // Nothing relevant exists: a good engine returns little or nothing.
  { q: 'biglietti per il concerto dei Coldplay', expect: [] },
  { q: 'quantum physics lecture notes', expect: [] },
  { q: 'ricetta del sushi', expect: [] }
]
