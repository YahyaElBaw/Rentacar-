import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfMake = require('pdfmake');
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class PdfService {
  constructor() {
    const fontPath = path.join(process.cwd(), 'node_modules', 'pdfmake', 'fonts', 'Roboto');
    const fonts = {
      Roboto: {
        normal: path.join(fontPath, 'Roboto-Regular.ttf'),
        bold: path.join(fontPath, 'Roboto-Medium.ttf'),
        italics: path.join(fontPath, 'Roboto-Italic.ttf'),
        bolditalics: path.join(fontPath, 'Roboto-MediumItalic.ttf')
      }
    };
    pdfMake.setFonts(fonts);
  }

  private formatDate(date: any): string {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private formatSimpleDate(date: any): string {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  private async getImageData(imagePath: string): Promise<string | null> {
    if (!imagePath) return null;
    try {
      // In NestJS, images are usually in public/uploads if served by ServeStatic
      const fullPath = path.join(process.cwd(), 'public', imagePath);
      if (!fs.existsSync(fullPath)) {
        console.warn(`Image not found at path: ${fullPath}`);
        return null;
      }
      const data = fs.readFileSync(fullPath);
      const base64 = data.toString('base64');
      const ext = path.extname(fullPath).toLowerCase().replace('.', '');
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64}`;
    } catch (e) {
      console.error('Failed to read image', e);
      return null;
    }
  }

  async generateContractPDF(contrat: any): Promise<Buffer> {
    const isClosed = contrat.status === 'closed' || contrat.status === 'clôturé' || contrat.status === 'terminé';
    const drivenDistance = (contrat.returnMileage || 0) - (contrat.startMileage || 0);

    const docDefinition: any = {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 40],
      content: [
        // Header
        {
          columns: [
            {
              stack: [
                { text: 'RENT CAR STUDIO', style: 'brand' },
                { text: 'Agence de Location de Voitures', style: 'brandSub' },
              ]
            },
            {
              stack: [
                { text: isClosed ? 'BILAN DE LOCATION' : 'CONTRAT DE LOCATION', style: 'docTitle' },
                { text: `Réf: ${contrat.reference}`, style: 'docRef' },
                { text: `Agent: ${contrat.createdBy?.firstName} ${contrat.createdBy?.lastName}`, style: 'docRef', margin: [0, 2, 0, 0] },
                { text: `Edité le: ${this.formatDate(new Date())}`, style: 'docDate' },
              ],
              alignment: 'right'
            }
          ]
        },

        { canvas: [{ type: 'line', x1: 0, y1: 10, x2: 515, y2: 10, lineWidth: 1, lineColor: '#e2e8f0' }] },

        // Section 1: Parties
        {
          columns: [
            {
              width: '50%',
              stack: [
                { text: 'LOCATAIRES', style: 'sectionLabel' },
                ...(contrat.clients || []).map((client: any) => [
                  { text: `${client.firstName} ${client.lastName}`, style: 'valueBold' },
                  { text: `CIN: ${client.cin || 'N/A'} | Tél: ${client.phone || 'N/A'}`, style: 'valueSmall', margin: [0, 0, 0, 4] },
                ]).flat()
              ]
            },
            {
              width: '50%',
              stack: [
                { text: 'VÉHICULE', style: 'sectionLabel' },
                { text: `${contrat.car?.brand} ${contrat.car?.model}`, style: 'valueBold' },
                { text: `Matricule: ${contrat.car?.matricule}`, style: 'valueSmall' },
                { text: `Couleur: ${contrat.car?.color || 'Standard'}`, style: 'valueSmall' },
              ],
              alignment: 'right'
            }
          ],
          margin: [0, 20, 0, 0]
        },

        // Section 2: Details Location
        { text: 'DÉTAILS DE LA LOCATION', style: 'tableHeader', margin: [0, 30, 0, 10] },
        {
          table: {
            widths: ['*', '*', '*', '*'],
            body: [
              [
                { text: 'Date Début', style: 'tdLabel' },
                { text: 'Date Fin', style: 'tdLabel' },
                { text: 'Caution', style: 'tdLabel' },
                { text: 'Tarif Journalier', style: 'tdLabel' }
              ],
              [
                { text: this.formatSimpleDate(contrat.startDate), style: 'tdValue' },
                { text: this.formatSimpleDate(contrat.endDate), style: 'tdValue' },
                { text: `${contrat.depositAmount} TND`, style: 'tdValue' },
                { text: `${contrat.car?.dailyRate} TND/J`, style: 'tdValue' }
              ]
            ]
          },
          layout: 'lightHorizontalLines'
        },

        // Section 3: BILAN DE RETOUR (Only if closed)
        isClosed ? [
          { text: 'BILAN DE RETOUR & RECONNAISSANCE', style: 'tableHeader', margin: [0, 30, 0, 10], color: '#059669' },
          {
            table: {
              widths: ['*', '*', '*', '*'],
              body: [
                [
                  { text: 'KM Départ', style: 'tdLabel' },
                  { text: 'KM Retour', style: 'tdLabel' },
                  { text: 'Distance', style: 'tdLabel' },
                  { text: 'État de retour', style: 'tdLabel' }
                ],
                [
                  { text: `${contrat.startMileage} KM`, style: 'tdValue' },
                  { text: `${contrat.returnMileage} KM`, style: 'tdValue' },
                  { text: `${drivenDistance} KM`, style: 'tdValueBold' },
                  { text: (contrat.carStateAtReturn || 'N/A').toUpperCase(), style: 'tdValueBold' }
                ]
              ]
            },
            layout: {
              hLineWidth: () => 1,
              vLineWidth: () => 0,
              hLineColor: () => '#ecfdf5',
              paddingLeft: () => 8,
              paddingRight: () => 8,
              paddingTop: () => 8,
              paddingBottom: () => 8,
            },
            fillColor: '#f0fdf4'
          },
          contrat.closureNotes ? {
            stack: [
              { text: 'OBSERVATIONS DE RETOUR', style: 'sectionLabel', margin: [0, 15, 0, 5] },
              { text: contrat.closureNotes, style: 'notesBox' }
            ]
          } : ''
        ] : '',

        // Section 4: HISTORIQUE DES PAIEMENTS (Shown if closed/paid)
        isClosed ? [
          { text: 'RÉCAPITULATIF FINANCIER & RÈGLEMENTS', style: 'tableHeader', margin: [0, 30, 0, 10] },
          {
            table: {
              widths: ['*', '*', '*', 'auto'],
              body: [
                [
                  { text: 'Libellé du Paiement', style: 'tdLabel' },
                  { text: 'Mode', style: 'tdLabel' },
                  { text: 'Date de Règlement', style: 'tdLabel' },
                  { text: 'Montant', style: 'tdLabel', alignment: 'right' }
                ],
                [
                  { text: 'Dépôt de Garantie (Caution)', style: 'tdValue' },
                  { text: 'Bloquée', style: 'tdValue' },
                  { text: this.formatSimpleDate(contrat.createdAt), style: 'tdValue' },
                  { text: `${(contrat.depositAmount || 0).toFixed(2)} TND`, style: 'tdValue', alignment: 'right' }
                ],
                contrat.isPaid ? [
                  { text: 'Prestation (Location)', style: 'tdValue' },
                  { text: (contrat.paymentMethod || 'Espèces/Chèque').toUpperCase(), style: 'tdValue' },
                  { text: this.formatSimpleDate(contrat.updatedAt), style: 'tdValue' },
                  { text: `${(contrat.totalAmount || 0).toFixed(2)} TND`, style: 'tdValue', alignment: 'right' }
                ] : []
              ].filter(row => row.length > 0)
            },
            layout: 'lightHorizontalLines'
          }
        ] : '',

        // Section 5: DÉCOMPTE FINANCIER
        { text: 'DÉCOMPTE FINANCIER', style: 'tableHeader', margin: [0, 30, 0, 10] },
        {
          table: {
            widths: ['*', 'auto'],
            body: [
              [
                { text: `Base HT (${Math.ceil((new Date(contrat.endDate).getTime() - new Date(contrat.startDate).getTime()) / (1000 * 60 * 60 * 24))} jours)`, style: 'tdValue' },
                { text: `${(Math.ceil((new Date(contrat.endDate).getTime() - new Date(contrat.startDate).getTime()) / (1000 * 60 * 60 * 24)) * (contrat.car?.dailyRate || 0)).toFixed(2)} TND`, style: 'tdValue', alignment: 'right' }
              ],
              contrat.contractTaxValue > 0 ? [
                { text: 'Frais sur contrat (Charge Agence)', style: 'tdValueSmall', color: '#64748b' },
                { text: `${contrat.contractTaxValue.toFixed(2)} TND`, style: 'tdValueSmall', alignment: 'right', color: '#64748b' }
              ] : [],
              contrat.tvaValue > 0 ? [
                { text: `TVA (${contrat.tvaValue}%)`, style: 'tdValue' },
                { text: `${((Math.ceil((new Date(contrat.endDate).getTime() - new Date(contrat.startDate).getTime()) / (1000 * 60 * 60 * 24)) * (contrat.car?.dailyRate || 0)) * (contrat.tvaValue / 100)).toFixed(2)} TND`, style: 'tdValue', alignment: 'right' }
              ] : [],
              [
                { text: isClosed ? 'TOTAL ENCAISSÉ (TTC)' : 'TOTAL ESTIMÉ (TTC)', style: 'totalLabel', margin: [0, 10, 0, 0] },
                { text: `${contrat.totalAmount.toFixed(2)} TND`, style: 'totalValue', margin: [0, 10, 0, 0] }
              ]
            ].filter(row => row.length > 0)
          },
          layout: 'noBorders',
          margin: [300, 0, 0, 0]
        },

        // Signatures
        {
          columns: [
            {
              stack: [
                { text: 'LE CLIENT', style: 'sectionLabel' },
                { text: '(Lu et approuvé)', style: 'signatureNote' },
                { text: '\n\n\n__________________________', style: 'signatureLine' }
              ]
            },
            {
              stack: [
                { text: "L'AGENCE", style: 'sectionLabel' },
                { text: '(Cachet et Signature)', style: 'signatureNote' },
                { text: '\n\n\n__________________________', style: 'signatureLine' }
              ],
              alignment: 'right'
            }
          ],
          margin: [0, 60, 0, 0]
        }
      ],
      styles: {
        brand: { fontSize: 18, bold: true, color: '#0f172a', letterSpacing: 2 },
        brandSub: { fontSize: 9, color: '#64748b', bold: true, uppercase: true },
        docTitle: { fontSize: 16, bold: true, color: '#0f172a' },
        docRef: { fontSize: 10, color: '#64748b', bold: true },
        docDate: { fontSize: 8, color: '#94a3b8' },
        sectionLabel: { fontSize: 8, bold: true, color: '#64748b', letterSpacing: 1, margin: [0, 0, 0, 4] },
        valueBold: { fontSize: 12, bold: true, color: '#0f172a' },
        valueSmall: { fontSize: 9, color: '#334155' },
        tableHeader: { fontSize: 10, bold: true, color: '#0f172a', letterSpacing: 1 },
        tdLabel: { fontSize: 8, color: '#64748b', bold: true, uppercase: true },
        tdValue: { fontSize: 10, color: '#0f172a', bold: true },
        tdValueSmall: { fontSize: 8, color: '#64748b', bold: false },
        tdValueBold: { fontSize: 11, color: '#059669', bold: true },
        notesBox: { fontSize: 9, italics: true, color: '#334155', background: '#f8fafc', padding: 10 },
        totalLabel: { fontSize: 10, bold: true, color: '#64748b' },
        totalValue: { fontSize: 20, bold: true, color: isClosed ? '#059669' : '#0f172a', alignment: 'right' },
        signatureNote: { fontSize: 7, italic: true, color: '#94a3b8' },
        signatureLine: { color: '#e2e8f0' }
      },
      defaultStyle: {
        font: 'Roboto'
      }
    };

    const doc = pdfMake.createPdf(docDefinition);
    return await doc.getBuffer();
  }

  async generateClientPDF(client: any): Promise<Buffer> {
    const cinFront = await this.getImageData(client.cinFront);
    const cinBack = await this.getImageData(client.cinBack);
    const licenseFront = await this.getImageData(client.licenseFront);
    const licenseBack = await this.getImageData(client.licenseBack);

    const docDefinition: any = {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 40],
      content: [
        // Header
        {
          columns: [
            {
              stack: [
                { text: 'RENT CAR STUDIO', style: 'brand' },
                { text: 'Fiche Client Personnalisée', style: 'brandSub' },
              ]
            },
            {
              stack: [
                { text: 'DOSSIER CLIENT', style: 'docTitle' },
                { text: `ID: ${client._id}`, style: 'docRef' },
                { text: `Généré le: ${this.formatDate(new Date())}`, style: 'docDate' },
              ],
              alignment: 'right'
            }
          ]
        },

        { canvas: [{ type: 'line', x1: 0, y1: 10, x2: 515, y2: 10, lineWidth: 1, lineColor: '#e2e8f0' }] },

        // Section 1: Personal Info
        { text: 'INFORMATIONS PERSONNELLES', style: 'tableHeader', margin: [0, 20, 0, 10] },
        {
          table: {
            widths: ['*', '*'],
            body: [
              [
                { stack: [{ text: 'NOM ET PRÉNOM', style: 'tdLabel' }, { text: `${client.firstName} ${client.lastName}`.toUpperCase(), style: 'tdValue' }] },
                { stack: [{ text: 'DATE DE NAISSANCE', style: 'tdLabel' }, { text: this.formatSimpleDate(client.birthday), style: 'tdValue' }] },
              ],
              [
                { stack: [{ text: 'NUMÉRO DE TÉLÉPHONE', style: 'tdLabel' }, { text: client.phone || 'N/A', style: 'tdValue' }] },
                { stack: [{ text: 'ADRESSE DOMICILE', style: 'tdLabel' }, { text: client.address || 'N/A', style: 'tdValue' }] },
              ],
              [
                {
                  stack: [
                    {
                      text: client.idCardType === 'passport' ? 'NUMÉRO PASSEPORT' : (client.idCardType === 'carte_sejour' ? 'NUMÉRO CARTE DE SÉJOUR' : 'NUMÉRO CIN'),
                      style: 'tdLabel'
                    },
                    { text: client.cin || 'N/A', style: 'tdValue' }
                  ]
                },
                {
                  stack: [
                    {
                      text: client.idCardType === 'passport' ? 'DATE DE DÉLIVRANCE PASSEPORT' : (client.idCardType === 'carte_sejour' ? "DATE D'ÉMISSION CARTE DE SÉJOUR" : "DATE D'EXPORTATION CIN"),
                      style: 'tdLabel'
                    },
                    { text: this.formatSimpleDate(client.cinDate), style: 'tdValue' }
                  ]
                }
              ],
              [
                { stack: [{ text: 'NUMÉRO PERMIS', style: 'tdLabel' }, { text: client.drivingLicense || 'N/A', style: 'tdValue' }] },
                { stack: [{ text: "DATE D'EXPORTATION PERMIS", style: 'tdLabel' }, { text: this.formatSimpleDate(client.licenseDate), style: 'tdValue' }] },
              ]
            ]
          },
          layout: 'lightHorizontalLines'
        },

        // Section 2: Documents
        { text: "PIÈCES JUSTIFICATIVES", style: 'tableHeader', margin: [0, 30, 0, 10] },

        client.idCardType === 'passport' ? {
          columns: [
            { width: '*', text: '' },
            {
              width: 300,
              stack: [
                { text: 'PASSEPORT', style: 'sectionLabel', alignment: 'center' },
                cinFront ? { image: cinFront, width: 300, margin: [0, 5, 0, 0] } : { text: 'NON DISPONIBLE', style: 'valueSmall', alignment: 'center', margin: [0, 5, 0, 0] }
              ]
            },
            { width: '*', text: '' }
          ],
          margin: [0, 0, 0, 20]
        } : {
          columns: [
            {
              stack: [
                { text: client.idCardType === 'carte_sejour' ? 'CARTE DE SÉJOUR (RECTO)' : 'CIN (RECTO)', style: 'sectionLabel', alignment: 'center' },
                cinFront ? { image: cinFront, width: 220, margin: [0, 5, 0, 0] } : { text: 'NON DISPONIBLE', style: 'valueSmall', alignment: 'center', margin: [0, 5, 0, 0] }
              ]
            },
            {
              stack: [
                { text: client.idCardType === 'carte_sejour' ? 'CARTE DE SÉJOUR (VERSO)' : 'CIN (VERSO)', style: 'sectionLabel', alignment: 'center' },
                cinBack ? { image: cinBack, width: 220, margin: [0, 5, 0, 0] } : { text: 'NON DISPONIBLE', style: 'valueSmall', alignment: 'center', margin: [0, 5, 0, 0] }
              ]
            }
          ],
          columnGap: 20,
          margin: [0, 0, 0, 20]
        },

        {
          columns: [
            {
              stack: [
                { text: 'PERMIS (RECTO)', style: 'sectionLabel', alignment: 'center' },
                licenseFront ? { image: licenseFront, width: 220, margin: [0, 5, 0, 0] } : { text: 'NON DISPONIBLE', style: 'valueSmall', alignment: 'center', margin: [0, 5, 0, 0] }
              ]
            },
            {
              stack: [
                { text: 'PERMIS (VERSO)', style: 'sectionLabel', alignment: 'center' },
                licenseBack ? { image: licenseBack, width: 220, margin: [0, 5, 0, 0] } : { text: 'NON DISPONIBLE', style: 'valueSmall', alignment: 'center', margin: [0, 5, 0, 0] }
              ]
            }
          ],
          columnGap: 20
        },

        // Signature Section
        {
          columns: [
            { width: '*', text: '' },
            {
              width: 200,
              stack: [
                { text: 'SIGNATURE', style: 'sectionLabel', alignment: 'center', margin: [0, 50, 0, 10] },
              ]
            }
          ]
        }
      ],
      styles: {
        brand: { fontSize: 18, bold: true, color: '#0f172a', letterSpacing: 2 },
        brandSub: { fontSize: 9, color: '#64748b', bold: true, uppercase: true },
        docTitle: { fontSize: 16, bold: true, color: '#0f172a' },
        docRef: { fontSize: 10, color: '#64748b', bold: true },
        docDate: { fontSize: 8, color: '#94a3b8' },
        sectionLabel: { fontSize: 8, bold: true, color: '#64748b', letterSpacing: 1, margin: [0, 0, 0, 4] },
        valueBold: { fontSize: 12, bold: true, color: '#0f172a' },
        valueSmall: { fontSize: 9, color: '#334155' },
        tableHeader: { fontSize: 10, bold: true, color: '#0f172a', letterSpacing: 1 },
        tdLabel: { fontSize: 8, color: '#64748b', bold: true, uppercase: true },
        tdValue: { fontSize: 10, color: '#0f172a', bold: true },
        signatureNote: { fontSize: 7, italic: true, color: '#94a3b8' }
      },
      defaultStyle: {
        font: 'Roboto'
      }
    };

    const doc = pdfMake.createPdf(docDefinition);
    return await doc.getBuffer();
  }
}
